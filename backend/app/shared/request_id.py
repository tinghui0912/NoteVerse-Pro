"""HTTP request identity shared by ingress and error representations."""

import re
from typing import Annotated

from pydantic import StringConstraints

REQUEST_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
RequestId = Annotated[
    str,
    StringConstraints(min_length=1, max_length=128, pattern=REQUEST_ID_PATTERN.pattern),
]
