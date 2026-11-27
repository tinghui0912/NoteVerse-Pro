"""HTTP session scope uses the factory attached by the owning application."""

from collections.abc import Generator

from fastapi import Depends, Request
from sqlalchemy.orm import Session


def get_db(request: Request) -> Generator[Session, None, None]:
    with request.app.state.session_factory() as session:
        try:
            yield session
        except BaseException:
            session.rollback()
            raise


def get_command_db(
    db: Session = Depends(get_db, scope="function"),
) -> Generator[Session, None, None]:
    try:
        yield db
        db.commit()
    except BaseException:
        db.rollback()
        raise
