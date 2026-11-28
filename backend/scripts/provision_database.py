"""Provision explicit database roles or apply the reviewed runtime grant contract."""

import argparse
import os
from sqlalchemy import create_engine
from sqlalchemy.exc import SQLAlchemyError
from psycopg import Error as PostgresError
from app.platform.db.authorization import DATABASE_ROLES, bootstrap_roles, apply_runtime_grants


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("bootstrap", "grants"))
    parser.add_argument("--schema", default="public")
    args = parser.parse_args()
    variable = "NOTEVERSE_DB_ADMIN_URL" if args.action == "bootstrap" else "DATABASE_URL"
    engine = None
    try:
        engine = create_engine(os.environ[variable], hide_parameters=True)
        with engine.begin() as connection:
            if args.action == "bootstrap":
                passwords = {
                    role: os.environ[role.upper() + "_PASSWORD"] for role in DATABASE_ROLES
                }
                bootstrap_roles(connection, args.schema, passwords)
            else:
                apply_runtime_grants(connection, args.schema)
    except (SQLAlchemyError, PostgresError, ValueError, KeyError):
        raise SystemExit(
            "Database authorization failed; inspect database server diagnostics using the administrator connection"
        ) from None
    finally:
        if engine is not None:
            engine.dispose()
    print("Database authorization contract applied")


if __name__ == "__main__":
    main()
