import asyncio
from pathlib import Path


class FileStorage:
    """Keeps original uploads on local disk so documents can be re-ingested later."""

    def __init__(self, root: Path) -> None:
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)

    def path_for(self, document_id: str, file_type: str) -> Path:
        # Names derive from server-generated ids, never from user-supplied filenames.
        return self.root / f"{document_id}.{file_type}"

    async def save(self, document_id: str, file_type: str, data: bytes) -> None:
        await asyncio.to_thread(self.path_for(document_id, file_type).write_bytes, data)

    async def read(self, document_id: str, file_type: str) -> bytes:
        return await asyncio.to_thread(self.path_for(document_id, file_type).read_bytes)

    async def delete(self, document_id: str, file_type: str) -> None:
        await asyncio.to_thread(self.path_for(document_id, file_type).unlink, missing_ok=True)
