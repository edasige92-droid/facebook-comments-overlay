const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const fetch = require("node-fetch");

const app = express();
const server = http.createServer(app);

// Fix for Render: Proper CORS setup
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Render provides port via environment variable
const PORT = process.env.PORT || 3000;

// Get credentials from environment variables
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VIDEO_ID = process.env.VIDEO_ID || "836332258915642";

// Security check
if (!PAGE_ACCESS_TOKEN) {
    console.error("❌ ERROR: PAGE_ACCESS_TOKEN environment variable is required");
    process.exit(1);
}

// Serve static files
app.use(express.static("public"));

// Basic route for testing
app.get("/", (req, res) => {
    res.send(`
        <html>
            <head><title>Facebook Comments Overlay</title></head>
            <body>
                <h1>Facebook Comments Overlay Server</h1>
                <p>Server is running! Use this URL in OBS:</p>
                <p><a href="/overlay.html">/overlay.html</a></p>
                <p><strong>🎲 Comments are SHUFFLED randomly!</strong></p>
            </body>
        </html>
    `);
});

// Health check endpoint for Render
app.get("/health", (req, res) => {
    res.status(200).json({ status: "OK", timestamp: new Date().toISOString() });
});

// Socket.io connection handling
io.on('connection', (socket) => {
    console.log('📱 Client connected:', socket.id);
    
    socket.on('disconnect', () => {
        console.log('📱 Client disconnected:', socket.id);
    });
});

// SHUFFLE FUNCTION - Randomize array order
function shuffleArray(array) {
    const newArray = [...array]; // Create a copy to avoid modifying original
    for (let i = newArray.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [newArray[i], newArray[j]] = [newArray[j], newArray[i]]; // Swap elements
    }
    return newArray;
}

// Function to get comments from Facebook
async function fetchComments() {
    try {
        console.log('🔄 Fetching comments from Facebook...');
        
        const url = `https://graph.facebook.com/v21.0/${VIDEO_ID}/comments?fields=from,message,created_time&access_token=${PAGE_ACCESS_TOKEN}`;
        console.log('📡 API URL:', url.replace(PAGE_ACCESS_TOKEN, 'TOKEN_HIDDEN'));
        
        const response = await fetch(url);
        
        console.log('📊 Response status:', response.status);
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('❌ HTTP Error:', response.status, errorText);
            return;
        }
        
        const data = await response.json();
        console.log('📦 API Response:', JSON.stringify(data).substring(0, 200) + '...');

        if (data.error) {
            console.error("❌ Facebook API error:", data.error);
            return;
        }

        if (data.data && data.data.length > 0) {
            // SHUFFLE THE COMMENTS BEFORE SENDING
            const shuffledComments = shuffleArray(data.data);
            io.emit("comments", shuffledComments);
            console.log(`✅ Sent ${shuffledComments.length} SHUFFLED comments to clients`);
        } else {
            console.log("💬 No comments found");
        }
    } catch (err) {
        console.error("❌ Network error:", err.message);
    }
}

// Create public folder and overlay.html
const fs = require('fs');
const path = require('path');

const publicDir = path.join(__dirname, 'public');
if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir);
}

// Create overlay.html
const overlayHtml = `
<!DOCTYPE html>
<html>
<head>
    <title>Facebook Comments Overlay</title>
    <meta charset="UTF-8">
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            margin: 0;
            padding: 20px;
            font-family: 'Arial', sans-serif;
            background: transparent;
            color: white;
            width: 100vw;
            min-height: 100vh;
        }
        .container {
            max-width: 800px;
            margin: 0 auto;
        }
        .comment {
            background: linear-gradient(135deg, rgba(0,0,0,0.8) 0%, rgba(50,50,50,0.6) 100%);
            padding: 15px;
            margin: 15px 0;
            border-radius: 10px;
            border-left: 5px solid #1877f2;
            backdrop-filter: blur(10px);
            animation: fadeIn 0.5s ease-in;
        }
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
        }
        .user {
            font-weight: bold;
            color: #1877f2;
            font-size: 18px;
            margin-bottom: 5px;
        }
        .message {
            font-size: 16px;
            line-height: 1.4;
            margin: 10px 0;
        }
        .time {
            font-size: 12px;
            color: #ccc;
            text-align: right;
        }
        .status {
            position: fixed;
            top: 10px;
            right: 10px;
            background: rgba(0,0,0,0.7);
            padding: 5px 10px;
            border-radius: 5px;
            font-size: 12px;
        }
        .connected { color: #4CAF50; }
        .disconnected { color: #f44336; }
        .error { color: #ff9800; }
        .shuffle-notice {
            position: fixed;
            top: 10px;
            left: 10px;
            background: rgba(255,193,7,0.9);
            color: black;
            padding: 5px 10px;
            border-radius: 5px;
            font-size: 12px;
            font-weight: bold;
        }
    </style>
</head>
<body>
    <div class="shuffle-notice">🎲 Comments Shuffled</div>
    <div class="status" id="status">Connecting...</div>
    <div class="container" id="commentsContainer">
        <div class="comment">
            <div class="user">System</div>
            <div class="message">Waiting for Facebook comments... Comments will appear in RANDOM order!</div>
            <div class="time" id="lastUpdate">Loading...</div>
        </div>
    </div>
    
    <script src="/socket.io/socket.io.js"></script>
    <script>
        const socket = io();
        const commentsContainer = document.getElementById('commentsContainer');
        const statusElement = document.getElementById('status');
        const lastUpdateElement = document.getElementById('lastUpdate');
        
        socket.on('connect', () => {
            console.log('✅ Connected to server');
            statusElement.innerHTML = '🟢 Connected to Server';
            statusElement.className = 'status connected';
            lastUpdateElement.textContent = 'Connected: ' + new Date().toLocaleTimeString();
        });
        
        socket.on('disconnect', () => {
            console.log('❌ Disconnected from server');
            statusElement.innerHTML = '🔴 Server Disconnected';
            statusElement.className = 'status disconnected';
        });
        
        socket.on('comments', (comments) => {
            console.log('Received SHUFFLED comments:', comments.length);
            lastUpdateElement.textContent = 'Last update: ' + new Date().toLocaleTimeString();
            
            // Clear existing comments
            commentsContainer.innerHTML = '';
            
            // Show latest 5 comments (already shuffled from server)
            const recentComments = comments.slice(0, 5);
            
            recentComments.forEach(comment => {
                const commentDiv = document.createElement('div');
                commentDiv.className = 'comment';
                
                const time = new Date(comment.created_time).toLocaleTimeString();
                
                commentDiv.innerHTML = \`
                    <div class="user">\${comment.from.name}</div>
                    <div class="message">\${comment.message}</div>
                    <div class="time">\${time}</div>
                \`;
                
                commentsContainer.appendChild(commentDiv);
            });
            
            if (recentComments.length === 0) {
                commentsContainer.innerHTML = \`
                    <div class="comment">
                        <div class="user">System</div>
                        <div class="message">No comments found. Make sure your Facebook Live is active and has comments.</div>
                        <div class="time">\${new Date().toLocaleTimeString()}</div>
                    </div>
                \`;
            }
        });
        
        socket.on('error', (error) => {
            console.error('Socket error:', error);
            statusElement.innerHTML = '⚠️ Server Error';
            statusElement.className = 'status error';
        });
    </script>
</body>
</html>
`;

fs.writeFileSync(path.join(publicDir, 'overlay.html'), overlayHtml);
console.log('✅ Created overlay.html with SHUFFLE feature');

// Fix for Render: Use the port from environment variable
server.listen(PORT, '0.0.0.0', () => {
    console.log('🚀 Server started successfully!');
    console.log('📊 Port:', PORT);
    console.log('🔑 Token set:', PAGE_ACCESS_TOKEN ? 'Yes' : 'No');
    console.log('🎥 Video ID:', VIDEO_ID);
    console.log('🎲 SHUFFLE FEATURE: Comments will be randomized');
    console.log('⚡ Server will start fetching comments in 10 seconds...');
});

// Wait for server to fully start before fetching comments
setTimeout(() => {
    // Fetch immediately, then every 30 seconds
    fetchComments();
    setInterval(fetchComments, 30000);
}, 10000);
