from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Vision API"
    debug: bool = False

    max_upload_bytes: int = 10 * 1024 * 1024
    jpeg_quality: int = 90

    allowed_origins: list[str] = ["*"]

    model_config = SettingsConfigDict(env_file=".env")


settings = Settings()