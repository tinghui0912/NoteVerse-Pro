from sqlalchemy import text
from app.platform.db.engine import build_engine
from app.runtime.cli.settings import DatabaseCommandSettings


def reset_alembic():
    engine = build_engine(DatabaseCommandSettings())
    with engine.begin() as conn:
        try:
            conn.execute(text("DROP TABLE alembic_version"))
            print("Dropped alembic_version table.")
        except Exception as e:
            print(f"Error: {e}")
    engine.dispose()


if __name__ == "__main__":
    reset_alembic()
