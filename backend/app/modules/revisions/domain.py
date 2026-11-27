"""Domain-owned resource states."""

import enum


class RevisionOrigin(str, enum.Enum):
    OMR = "OMR"
    EDIT = "EDIT"
    IMPORT = "IMPORT"


class RevisionSourceFormat(str, enum.Enum):
    MUSICXML = "MUSICXML"
