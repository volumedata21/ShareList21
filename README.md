# ShareList21
Quickly search through media inventory.<br><br>
<img width="613" height="701" alt="Captura de pantalla 2025-12-15 a la(s) 2 25 18 p m" src="https://github.com/user-attachments/assets/cb0739b2-9fd4-4055-b60c-b2c25f07009c" />

### Server compose.yaml
This includes both the host's server and a client part. If there are multiple users, the server hosting the main database should use this compose file. 
```
services:
  sharelist-server:
    image: volumedata21/sharelist21:latest
    container_name: sharelist-server
    restart: unless-stopped
    ports:
      - "5021:80"
    volumes:
      - ./data:/data
      # You can add multiple folders
#     - ./media/movies:/media/movies
#     - ./tv:/media/tv
    environment:
      - ROLE=SERVER
      - APP_USERS=Joe,Lamar,Josh # Add/remove users here
      - APP_PIN=1234
      - SYNC_SECRET=a4f9d8c7e6b5a4... # run 'openssl rand -hex 32' for a secure secret
      - HOST_USER=Joe  # Enables the server to self-scan /media
      - MEDIA_ROOT=/media
```

### Client compose.yaml
If you have multiple users they should be using the client compose file. Directions to connect a client to the host:
1. Replace media volumes in the 'volumes:' section with location of media.
2. Replace environment variable 'CLIENT_USER' with your own username. Any name should work.
3. Replace environment variable 'SERVER_URL' with the host's URL. This may require the use is using SSL, so an HTTPS address may be required.
4. Replace environment variable 'SYNC_SECRET' with the SYNC_SECRET from the host. The host and client secrets must match.
5. (Optional) Change or eliminate 'CRON_SCHEDULE'. This runs a daily sync automatically.
```
services:
  sharelist-client:
    image: volumedata21/sharelist21:latest
    container_name: sharelist-client
    restart: unless-stopped
    volumes:
      - /location/of/Lamar/Media:/media:ro
#     - /location/of/Lamar/TV:/media/tv:ro
#     - /location/of/Lamar/Movies:/media/movies:ro
#     - /location/of/Lamar/Music:/media/music:ro
    environment:
      - ROLE=CLIENT
      - CLIENT_USER=Lamar
      - SERVER_URL=https://server.url.com # SSL is required on host server
      - SYNC_SECRET=a4f9d8c7e6b5a4...
      - CRON_SCHEDULE=0 3 * * * # runs sync every day at 3:00 AM
```
