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
      - ./media/movies:/media/movies
    environment:
      - APP_USERS=Joe,Lamar,Josh # Must add all users here
      - APP_PIN=1234
      - SYNC_SECRET=REPLACEME # Same secret for everyone
      - HOST_USER=Joe
      # No MASTER_URL means "I am the Master"
      - MEDIA_ROOT=/media
      - CRON_SCHEDULE=0 3 * * * # Optional, auto sync at 3 AM

# Generate a SYNC_SECRET using command line: 'openssl rand -hex 32'
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
    ports:
      - "5021:80" #Frontend
    volumes:
      - ./data:/data  # Folder for app's database
      - /location/of/your/Movies:/media/movies
#     - /location/of/your/TV:/media/tv
#     - /location/of/your/Music:/media/music
#     - /location/of/your/media:/media
    environment:
      - APP_PIN=1234
      - SYNC_SECRET=REPLACEME # Must match host's SYNC_SECRET
      - HOST_USER=Lamar # Your username, must be exactly as written in host's compose file.
      - MASTER_URL=https://replace-me-with-the-hostserver.com # URL of host's server
      - MEDIA_ROOT=/media
      - CRON_SCHEDULE=0 3 * * * # Optional, auto sync at 3 AM
```
