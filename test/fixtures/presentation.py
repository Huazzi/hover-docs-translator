def parse_value(value: str) -> int:
    """Parse a numeric value.

    Args:
        value: Text containing an integer.

    Returns:
        The parsed integer.

    Raises:
        ValueError: If the text is not a valid integer.

    Examples:
        >>> parse_value("12")
        12
    """
    return int(value)

parse_value("12")
