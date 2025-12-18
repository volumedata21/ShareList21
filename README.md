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
      - /path/to/media:/media/
      - /path/to/movies:/media/movies

    environment:
      - APP_USERS=Joe,Lamar,Josh # Must add all users here
      - APP_PIN=1234
      - SYNC_SECRET=REPLACEME # Same secret for everyone
      - HOST_USER=Joe
      - MEDIA_ROOT=/media
      - DOWNLOAD_ROOT=/downloads
      - CRON_SCHEDULE=0 3 * * * # Optional, auto sync at 3 AM
      - NODE_URL=https://MySL21URL.com
        # CRITICAL: This must be your Public IP or Domain. 
        # Clients use this URL to connect to you.

# Generate a SYNC_SECRET using command line: 'openssl rand -hex 32'
```

### Client compose.yaml
If you have multiple users they should be using the client compose file. Directions to connect a client to the host:
1. Replace media volumes in the 'volumes:' section with location of media.
2. Replace downloads volume in the 'volumes:' section. This will be the location for media that you download from other users.
2. Replace environment variable 'CLIENT_USER' with your own username. Any name should work.
3. Replace environment variable 'SERVER_URL' with the host's URL. This may require the use is using SSL, so an HTTPS address may be required.
4. Replace environment variable 'SYNC_SECRET' with the SYNC_SECRET from the host. The host and client secrets must match.
5. (Optional) Change or eliminate 'CRON_SCHEDULE'. This runs a daily sync automatically.
6. Replace NODE_URL 
```
sharelist-client:
    image: volumedata21/sharelist21:latest
    container_name: sharelist-client
    restart: unless-stopped
    ports:
      - "5021:80" #Frontend
    volumes:
      - ./data:/data  # Folder for app's database
      - /location/of/your/Movies:/media/movies
      - /location/for/Downloads:/downloads
#     - /location/of/your/TV:/media/tv
#     - /location/of/your/Music:/media/music
#     - /location/of/your/media:/media   
    environment:
      - APP_USERS=Joe,Lamar,Josh
      - APP_PIN=1234
      - SYNC_SECRET=12345
      - HOST_USER=Lamar # This is your username
      - MASTER_URL=https://MySL21URL.com 
        # This should be the host server's URL to sync everyone's database 
      - MEDIA_ROOT=/media
      - DOWNLOAD_ROOT=/downloads
      - PORT=80
      - NODE_URL=https://mynode.com 
        # URL to your SL21 instance, only if you want others to be able to download from your server.
    
```
