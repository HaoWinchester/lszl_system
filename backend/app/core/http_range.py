"""Bound a single HTTP byte range before a storage layer reads its body."""
import re


class RangeNotSatisfiable(ValueError):
    pass


def byte_range(header: str | None, size: int) -> tuple[int, int, bool]:
    """Return inclusive bounds and whether this is a partial representation.

    Multiple ranges are deliberately unsupported. Callers can send the total
    size in a 416 Content-Range without loading any binary content.
    """
    if header is None:
        return 0, size - 1, False
    match = re.fullmatch(r'bytes=([0-9]{0,20})-([0-9]{0,20})', header.strip())
    if match is None or not any(match.groups()) or size <= 0:
        raise RangeNotSatisfiable('Unsupported or unsatisfiable byte range')
    first, last = match.groups()
    if not first:
        suffix = int(last)
        if suffix == 0:
            raise RangeNotSatisfiable('Empty suffix range')
        return max(0, size - suffix), size - 1, True
    start = int(first)
    end = min(int(last), size - 1) if last else size - 1
    if start >= size or end < start:
        raise RangeNotSatisfiable('Range lies outside the representation')
    return start, end, True
