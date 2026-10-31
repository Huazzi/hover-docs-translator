from pathlib import Path

def greet(name: str) -> str:
    """Return a greeting for the supplied name.

    The original name is preserved.
    """
    return f"Hello {name}"

greet("Ada")
Path("example")
