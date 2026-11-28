"""Schema-qualified database authorization objects from reviewed SQL contracts."""

from pathlib import Path
import re
from collections.abc import Mapping
from sqlalchemy import Connection
from sqlalchemy import text
from psycopg import sql

CONTRACT_DIRECTORY = Path(__file__).resolve().parents[3] / "db"
DATABASE_ROLES = (
    "nv_migrator",
    "nv_customer_api",
    "nv_control_plane",
    "nv_worker",
    "nv_beat",
)


def reviewed_tables() -> frozenset[str]:
    return frozenset(
        re.findall(r"^-- TABLE ([a-z_]+)$", (CONTRACT_DIRECTORY / "grants.sql").read_text(), re.M)
    )


def bootstrap_roles(connection: Connection, schema: str, passwords: Mapping[str, str]) -> None:
    """Database administrator bootstraps roles and an application-owned schema."""
    if (
        set(passwords) != set(DATABASE_ROLES)
        or len(set(passwords.values())) != len(DATABASE_ROLES)
        or any(len(value) < 20 for value in passwords.values())
    ):
        raise ValueError("Provide a separate password of at least 20 characters for each role")
    database_owner = connection.scalar(
        text("SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database()")
    )
    if database_owner in DATABASE_ROLES[1:]:
        raise ValueError("A long-running runtime cannot own the application database")
    for role in DATABASE_ROLES:
        attributes = connection.execute(
            text(
                "SELECT rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,rolinherit FROM pg_roles WHERE rolname=:role"
            ),
            {"role": role},
        ).one_or_none()
        if attributes is None:
            connection.exec_driver_sql(
                f"CREATE ROLE {role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT"
            )
        elif any(attributes):
            raise ValueError("Database role attributes do not match the least-privilege contract")
        if connection.scalar(
            text(
                "SELECT EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member WHERE r.rolname=:role)"
            ),
            {"role": role},
        ):
            raise ValueError("Runtime role membership is not permitted")
        statement = sql.SQL("ALTER ROLE {} LOGIN PASSWORD {}").format(
            sql.Identifier(role), sql.Literal(passwords[role])
        )
        with connection.connection.driver_connection.cursor() as cursor:
            cursor.execute(statement)
    quote = connection.dialect.identifier_preparer.quote_identifier
    database = connection.exec_driver_sql("SELECT current_database()").scalar_one()
    connection.exec_driver_sql(
        f"REVOKE CREATE,TEMPORARY ON DATABASE {quote(database)} FROM PUBLIC, {', '.join(DATABASE_ROLES[1:])}"
    )
    connection.exec_driver_sql(
        f"GRANT CONNECT ON DATABASE {quote(database)} TO {', '.join(DATABASE_ROLES)}"
    )
    connection.exec_driver_sql(
        "REVOKE CREATE ON SCHEMA public FROM PUBLIC, " + ", ".join(DATABASE_ROLES[1:])
    )
    connection.exec_driver_sql(
        f"CREATE SCHEMA IF NOT EXISTS {quote(schema)} AUTHORIZATION nv_migrator"
    )
    owner = connection.scalar(
        text("SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname=:schema"),
        {"schema": schema},
    )
    if owner != "nv_migrator":
        occupied = connection.scalar(
            text(
                "SELECT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=:schema)"
            ),
            {"schema": schema},
        )
        if occupied:
            raise ValueError("Migrate an empty schema owned by nv_migrator")
        connection.exec_driver_sql(f"ALTER SCHEMA {quote(schema)} OWNER TO nv_migrator")
    connection.exec_driver_sql(
        f"REVOKE CREATE ON SCHEMA {quote(schema)} FROM PUBLIC, {', '.join(DATABASE_ROLES[1:])}"
    )


def apply_runtime_grants(connection: Connection, schema: str) -> None:
    """Apply the exact SQL allowlist after nv_migrator creates the schema."""
    objects = connection.execute(
        text(
            "SELECT c.relname,pg_get_userbyid(c.relowner) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=:schema AND c.relkind IN ('r','p')"
        ),
        {"schema": schema},
    ).all()
    owners = dict(objects)
    if not reviewed_tables() <= owners.keys() or any(
        owner != "nv_migrator" for owner in owners.values()
    ):
        raise ValueError("All reviewed tables must exist and belong to nv_migrator")
    connection.exec_driver_sql(
        render_contract(connection, "grants.sql", schema),
        execution_options={"no_parameters": True},
    )


def render_contract(connection: Connection, filename: str, schema: str) -> str:
    if filename not in {"security_functions.sql", "grants.sql"}:
        raise ValueError("Unknown database authorization contract")
    identifier = connection.dialect.identifier_preparer.quote_identifier(schema)
    return (
        (CONTRACT_DIRECTORY / filename)
        .read_text(encoding="utf-8")
        .replace(
            "__APP_SCHEMA_LITERAL__",
            sql.Literal(schema).as_string(connection.connection.driver_connection),
        )
        .replace("__APP_SCHEMA__", identifier)
    )


def install_security_functions(connection: Connection) -> None:
    schema = connection.exec_driver_sql("SELECT current_schema()").scalar_one()
    connection.exec_driver_sql(render_contract(connection, "security_functions.sql", schema))
