"""PostgreSQL scheduler-lock primitives.

The package deliberately performs no eager imports.  Beat only needs the
psycopg-based leader supervisor, while worker scan tasks explicitly import the
SQLAlchemy-based task lock service.
"""
