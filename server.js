const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const fetch = require("node-fetch");

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3000;
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VIDEO_ID = process.env.VIDEO_ID || "657216063676510";

if (!PAGE_ACCESS_TOKEN) {
    console.error("❌ ERROR: PAGE_ACCESS_TOKEN environment variable is required");
    process.exit(1);
}

app.use(express.static("public"));

app.get("/", (req, res) => {
    res.send(`
        <html>
            <head><title>Facebook Comments Overlay</title></head>
            <body>
                <h1>Facebook Comments Overlay Server</h1>
                <p>Server is running! Use this URL in OBS:</p>
                <p><a href="/overlay.html">/overlay.html</a></p>
            </body>
        </html>
    `);
});

io.on('connection', (socket) => {
    console.log('📱 Client connected');
});

async function fetchComments() {
    try {
        const url = `https://graph.facebook.com/v21.0/${VIDEO_ID}/comments?fields=from,message,created_time&access_token=${PAGE_ACCESS_TOKEN}`;
        const response = await fetch(url);
        
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        
        const data = await response.json();
        if (data.error) {
            console.error("❌ Facebook API error:", data.error.message);
            return;
        }

        if (data.data && data.data.length > 0) {
            io.emit("comments", data.data);
            console.log(`✅ Sent ${data.data.length} comments`);
        }
    } catch (err) {
        console.error("❌ Error:", err.message);
    }
}

// Create public folder and overlay.html
const fs = require('fs');
const path = require('path');

const publicDir = path.join(__dirname, 'public');
if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir);

const overlayHtml = `
<!DOCTYPE html>
<html>
<head>
    <title>Facebook Comments Overlay</title>
    <style>
        body { margin: 0; padding: 20px; font-family: Arial; background: transparent; color: white; }
        .comment { background: rgba(0,0,0,0.8); padding: 15px; margin: 10px 0; border-radius: 10px; border-left: 5px solid #1877f2; }
        .user { font-weight: bold; color: #1877f2; }
    </style>
</head>
<body>
    <div id="comments">
        <div class="comment">
            <div class="user">System</div>
            <div>Waiting for Facebook comments...</div>
        </div>
    </div>
    <script src="/socket.io/socket.io.js"></script>
    <script>
        const socket = io();
        socket.on('comments', (comments) => {
            const container = document.getElementById('comments');
            container.innerHTML = '';
            comments.slice(0, 5).forEach(comment => {
                const div = document.createElement('div');
                div.className = 'comment';
                div.innerHTML = '<div class="user">' + comment.from.name + '</div><div>' + comment.message + '</div>';
                container.appendChild(div);
            });
        });
    </script>
</body>
</html>
`;

fs.writeFileSync(path.join(publicDir, 'overlay.html'), overlayHtml);
console.log('✅ Server ready!');

setInterval(fetchComments, 15000);
setTimeout(fetchComments, 2000);

server.listen(PORT, () => {
    console.log('🚀 Server running on port ' + PORT);
});
