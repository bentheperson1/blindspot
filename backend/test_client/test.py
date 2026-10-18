import asyncio
import websockets


async def main():
	url = "wss://11.32.6.184/images/stream"
	headers = {"x-api-key": "YOUR_KEY"}
	
	async with websockets.connect(url, additional_headers=headers) as ws:
		await ws.send(b"junk")
		print(await ws.recv())


asyncio.run(main())