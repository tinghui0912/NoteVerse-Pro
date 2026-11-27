from sqlalchemy import text
from app.db.session import engine


def reset_alembic():
    with engine.begin() as conn:
        try:
            conn.execute(text("DROP TABLE alembic_version"))
            print("Dropped alembic_version table.")
        except Exception as e:
            print(f"Error: {e}")
    engine.dispose()


if __name__ == "__main__":
    reset_alembic()
