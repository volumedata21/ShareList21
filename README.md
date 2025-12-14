# ShareList21

### Server compose.yaml
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
      - ./media/movies:/media/movies
#     - ./tv:/media/tv
    environment:
      - ROLE=SERVER
      - APP_USERS=Joe,Lamar,Josh # Add/remove users here
      - APP_PIN=1234
      - HOST_USER=Joe  # Enables the server to self-scan /media
      - MEDIA_ROOT=/media
```

### Client compose.yaml
```
services:
  sharelist-client:
    image: volumedata21/sharelist21:latest
    container_name: sharelist-client
    restart: unless-stopped
    # No ports needed! It's just an outgoing script.
    volumes:
      - /c/Users/Lamaar/Movies:/media  # Lamaar's local media
    environment:
      - ROLE=CLIENT
      - CLIENT_USER=Lamaar
      - SERVER_URL=https://sharelist.joe.com  # URL to Joe's Server
      - APP_PIN=1234
      - CRON_SCHEDULE=0 3 * * * # Run at 3am
```