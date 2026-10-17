from pydantic import BaseModel


class ImageInfo(BaseModel):
    width: int
    height: int
    channels: int


class Base64ImageRequest(BaseModel):
    image: str


class Base64ImageResponse(BaseModel):
    image: str