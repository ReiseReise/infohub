"""Bound Range parsing before passing requests to the file response."""

import re


def is_supported_audio_range(values: list[str]) -> bool:
    if not values:
        return True
    # Older Starlette releases have a costly multipart Range merge path.
    # Browser seeking needs only one bounded bytes range per request.
    return (len(values) == 1 and len(values[0]) <= 128
            and re.fullmatch(r"bytes=(?:[0-9]+-[0-9]*|-[0-9]+)", values[0], re.ASCII) is not None)
