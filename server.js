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
                <p><strong>🎲 Comments continuously SHUFFLE (new + old)!</strong></p>
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

// Store all comments in memory
let allComments = [];
let lastFetchTime = null;

// SHUFFLE FUNCTION - Randomize array order
function shuffleArray(array) {
    const newArray = [...array];
    for (let i = newArray.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
    }
    return newArray;
}

// Function to validate and clean comments
function cleanComments(comments) {
    return comments.filter(comment => {
        // Only keep comments that have required fields
        return comment && 
               comment.message && 
               comment.from && 
               comment.from.name &&
               comment.created_time;
    }).map(comment => ({
        // Ensure all fields are present
        message: comment.message || 'No message',
        from: {
            name: comment.from?.name || 'Unknown User'
        },
        created_time: comment.created_time,
        id: comment.id
    }));
}

// Function to get a random selection of comments
function getRandomComments(count = 5) {
    if (allComments.length === 0) {
        return [];
    }
    
    // If we have fewer comments than requested, return all
    if (allComments.length <= count) {
        return shuffleArray(allComments);
    }
    
    // Get random comments from the entire collection
    const shuffled = shuffleArray(allComments);
    return shuffled.slice(0, count);
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
            return false;
        }
        
        const data = await response.json();
        console.log('📦 Received data with', data.data?.length || 0, 'comments');

        if (data.error) {
            console.error("❌ Facebook API error:", data.error);
            return false;
        }

        if (data.data && data.data.length > 0) {
            // Clean and validate comments before storing
            const cleanedComments = cleanComments(data.data);
            console.log(`✅ Cleaned ${cleanedComments.length} valid comments (from ${data.data.length} total)`);
            
            // Update our stored comments (replace all)
            allComments = cleanedComments;
            lastFetchTime = new Date();
            
            if (cleanedComments.length > 0) {
                console.log(`📝 Stored ${allComments.length} total valid comments`);
            }
            return true;
        } else {
            console.log("💬 No comments found in API response");
            return false;
        }
    } catch (err) {
        console.error("❌ Network error:", err.message);
        return false;
    }
}

// Function to send random comments to clients
function sendRandomComments() {
    try {
        if (allComments.length > 0) {
            const randomComments = getRandomComments(5);
            io.emit("comments", randomComments);
            console.log(`🎲 Sent ${randomComments.length} RANDOM comments (from ${allComments.length} total)`);
            
            // Safely log the comments that were sent
            randomComments.forEach((comment, index) => {
                const userName = comment.from?.name || 'Unknown User';
                const messagePreview = comment.message ? 
                    comment.message.substring(0, 30) + (comment.message.length > 30 ? '...' : '') : 
                    'No message';
                console.log(`   ${index + 1}. ${userName}: ${messagePreview}`);
            });
        } else {
            console.log("💬 No comments available to send");
            // Send empty array to clear display
            io.emit("comments", []);
        }
    } catch (error) {
        console.error('❌ Error in sendRandomComments:', error.message);
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
        .stats {
            position: fixed;
            bottom: 10px;
            right: 10px;
            background: rgba(0,0,0,0.7);
            padding: 5px 10px;
            border-radius: 5px;
            font-size: 11px;
            color: #ccc;
        }
        .connected { color: #4CAF50; }
        .disconnected { color: #f44336; }
        .error { color: #ff9800; }
    </style>
</head>
<body>
    <div class="shuffle-notice">🎲 Continuous Shuffle Active</div>
    <div class="status" id="status">Connecting...</div>
    <div class="stats" id="stats">Total comments: 0</div>
    <div class="container" id="commentsContainer">
        <div class="comment">
            <div class="user">System</div>
            <div class="message">Waiting for Facebook comments... System will continuously shuffle ALL comments (new + old)!</div>
            <div class="time" id="lastUpdate">Loading...</div>
        </div>
    </div>
    
    <script src="/socket.io/socket.io.js"></script>
    <script>
        const socket = io();
        const commentsContainer = document.getElementById('commentsContainer');
        const statusElement = document.getElementById('status');
        const lastUpdateElement = document.getElementById('lastUpdate');
        const statsElement = document.getElementById('stats');
        
        let totalCommentsCount = 0;
        
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
            console.log('Received RANDOM comments:', comments.length);
            totalCommentsCount = Math.max(totalCommentsCount, comments.length);
            lastUpdateElement.textContent = 'Last shuffle: ' + new Date().toLocaleTimeString();
            statsElement.textContent = 'Showing: ' + comments.length + ' random comments';
            
            // Clear existing comments
            commentsContainer.innerHTML = '';
            
            // Display the random comments
            comments.forEach(comment => {
                const commentDiv = document.createElement('div');
                commentDiv.className = 'comment';
                
                const time = new Date(comment.created_time).toLocaleTimeString();
                const date = new Date(comment.created_time).toLocaleDateString();
                const userName = comment.from?.name || 'Unknown User';
                
                commentDiv.innerHTML = \`
                    <div class="user">\${userName}</div>
                    <div class="message">\${comment.message}</div>
                    <div class="time">\${date} \${time}</div>
                \`;
                
                commentsContainer.appendChild(commentDiv);
            });
            
            if (comments.length === 0) {
                commentsContainer.innerHTML = \`
                    <div class="comment">
                        <div class="user">System</div>
                        <div class="message">No comments found yet. Comments will appear here once viewers start commenting!</div>
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
console.log('✅ Created overlay.html with CONTINUOUS SHUFFLE feature');

// Fix for Render: Use the port from environment variable
server.listen(PORT, '0.0.0.0', () => {
    console.log('🚀 Server started successfully!');
    console.log('📊 Port:', PORT);
    console.log('🔑 Token set:', PAGE_ACCESS_TOKEN ? 'Yes' : 'No');
    console.log('🎥 Video ID:', VIDEO_ID);
    console.log('🎲 CONTINUOUS SHUFFLE: Comments will randomly cycle every 20 seconds');
    console.log('🛡️  Added error handling for invalid comments');
    console.log('⚡ Server will start in 10 seconds...');
});

// Wait for server to fully start
setTimeout(() => {
    // Fetch comments from Facebook every 2 minutes
    fetchComments();
    setInterval(fetchComments, 120000); // 2 minutes
    
    // Send random comments to clients every 20 seconds
    setInterval(sendRandomComments, 20000); // 20 seconds
    
    // Send initial random comments after first fetch
    setTimeout(sendRandomComments, 15000);
}, 10000);
