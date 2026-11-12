FROM node:20-slim

# ffmpeg incluye ffprobe
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY server.js app.js index.html styles.css ./

ENV PORT=3100
EXPOSE 3100

USER node
CMD ["node", "server.js"]
