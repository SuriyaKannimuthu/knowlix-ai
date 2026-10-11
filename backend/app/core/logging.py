import logging


def configure_logging(level: str) -> None:
    logging.basicConfig(
        level=level.upper(),
        format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
    )
    # Third-party clients are chatty at INFO.
    for noisy in ("httpx", "httpx2", "httpcore", "anthropic", "openai", "google_genai"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
