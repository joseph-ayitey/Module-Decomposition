const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);

// CORS 
app.use(cors({
    origin: "*",
    methods: ["GET", "POST", "DELETE"]
}));

app.use(express.json());

// Serve frontend static files from same server
//frontend to backend folder
app.use(express.static(path.join(__dirname, "../Chat-frontend")));

const io = new Server(server, {
    cors: { 
        origin: "*",
        methods: ["GET", "POST"]
    },
    // PROXY SUPPORT
    transports: ['websocket', 'polling']
});

// IN-MEMORY STORAGE
let messages = [];
let allUsers = new Map(); // username -> { online, lastSeen, socketId }
let messageIdCounter = 1;

// VALIDATIONS

const validateUsername = (username) => {
    const errors = [];
    if (!username || typeof username !== "string") {
        errors.push("Username is required");
    } else {
        const trimmed = username.trim();
        if (trimmed.length === 0) errors.push("Username cannot be empty");
        if (trimmed.length > 30) errors.push("Username must be less than 30 characters");
        if (!/^[a-zA-Z0-9_\-\s]+$/.test(trimmed)) {
            errors.push("Username can only contain letters, numbers, spaces, underscores and hyphens");
        }
    }
    return errors;
};

const validateMessage = (data) => {
    const errors = [];
    
    if (!data.user || typeof data.user !== "string" || data.user.trim().length === 0) {
        errors.push("User is required");
    }
    
    if (!data.text || typeof data.text !== "string" || data.text.trim().length === 0) {
        errors.push("Message text is required");
    } else if (data.text.length > 1000) {
        errors.push("Message must be less than 1000 characters");
    }
    
    if (data.color && !/^#[0-9A-Fa-f]{6}$/.test(data.color)) {
        errors.push("Invalid color format (must be #RRGGBB)");
    }
    
    if (data.scheduledFor) {
        const scheduledDate = new Date(data.scheduledFor);
        if (isNaN(scheduledDate.getTime())) {
            errors.push("Invalid scheduled time format");
        } else if (scheduledDate <= new Date()) {
            errors.push("Scheduled time must be in the future");
        }
    }
    
    if (data.replyTo !== undefined && data.replyTo !== null) {
        const parent = messages.find(m => m.id === data.replyTo);
        if (!parent) {
            errors.push("Reply references a non-existent message");
        }
    }
    
    return errors;
};

const validateVote = (id) => {
    const errors = [];
    const msg = messages.find(m => m.id === id);
    if (!msg) errors.push("Message not found");
    return { errors, msg };
};

// FORMATTING HELPER 

const processFormatting = (text) => {
    return text
        .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
        .replace(/\*(.*?)\*/g, "<em>$1</em>")
        .replace(/~(.*?)~/g, "<u>$1</u>");
};

// USER MANAGEMENT (ONLINE ONLY) - FEATURE

function emitOnlineUsers() {
    // ONLY send currently ONLINE users - offline users disappear completely
    const onlineUsers = Array.from(allUsers.entries())
        .filter(([name, data]) => data.online)
        .map(([name, data]) => ({ name }));
    
    io.emit("online_users", onlineUsers);
}

// SCHEDULER 

const checkScheduledMessages = () => {
    const now = new Date();
    messages.forEach(msg => {
        if (msg.scheduledFor && !msg.delivered && new Date(msg.scheduledFor) <= now) {
            msg.delivered = true;
            io.emit("receive_message", msg);
        }
    });
};

setInterval(checkScheduledMessages, 1000);

//  API ENDPOINTS 

app.get("/messages", (req, res) => {
    const now = new Date();
    const visible = messages
        .filter(m => !m.scheduledFor || new Date(m.scheduledFor) <= now)
        .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    
    res.json({ success: true, count: visible.length, data: visible });
});

app.get("/messages/:id", (req, res) => {
    const msg = messages.find(m => m.id === parseInt(req.params.id));
    if (!msg) {
        return res.status(404).json({ success: false, error: "Message not found" });
    }
    res.json({ success: true, data: msg });
});

app.post("/messages", (req, res) => {
    const errors = validateMessage(req.body);
    if (errors.length > 0) {
        return res.status(400).json({ success: false, errors });
    }
    
    const newMessage = createMessage(req.body);
    messages.push(newMessage);
    
    if (!newMessage.scheduledFor) {
        io.emit("receive_message", newMessage);
    }
    
    res.status(201).json({ success: true, data: newMessage });
});

app.post("/messages/:id/vote", (req, res) => {
    const { type } = req.body;
    const { errors, msg } = validateVote(parseInt(req.params.id));
    
    if (errors.length > 0) {
        return res.status(400).json({ success: false, errors });
    }
    
    if (type === "like") {
        msg.likes++;
    } else if (type === "dislike") {
        msg.dislikes++;
    } else {
        return res.status(400).json({ success: false, error: "Vote type must be 'like' or 'dislike'" });
    }
    
    io.emit("update_message", msg);
    res.json({ success: true, data: { likes: msg.likes, dislikes: msg.dislikes } });
});

app.delete("/messages/:id", (req, res) => {
    const idx = messages.findIndex(m => m.id === parseInt(req.params.id));
    if (idx === -1) {
        return res.status(404).json({ success: false, error: "Message not found" });
    }
    
    messages.splice(idx, 1);
    io.emit("message_deleted", parseInt(req.params.id));
    res.json({ success: true, message: "Message deleted" });
});

app.get("/users", (_req, res) => {
    const users = Array.from(allUsers.entries()).map(([name, data]) => ({
        name,
        online: data.online,
        lastSeen: data.lastSeen
    }));
    res.json({ success: true, data: users });
});

// MESSAGE FACTORY / SETUP

function createMessage(data) {
    const now = new Date();
    return {
        id: messageIdCounter++,
        text: data.text.trim(),
        formattedText: processFormatting(data.text.trim()),
        user: data.user.trim(),
        color: data.color || "#3b82f6",
        likes: 0,
        dislikes: 0,
        replyTo: data.replyTo || null,
        scheduledFor: data.scheduledFor || null,
        delivered: !data.scheduledFor,
        createdAt: now.toISOString()
    };
}

// SOCKET.IO HANDLERS 

io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    // Send existing messages and online users
    socket.emit("load_messages",
    messages.filter(
        m => m.delivered
    )
);

    // JOIN - User sets username
    socket.on("join", (username) => {
        const errors = validateUsername(username);
        if (errors.length > 0) {
            socket.emit("error", errors.join(", "));
            return;
        }
        
        const cleanName = username.trim();
        socket.username = cleanName;
        
        // Store user with online status
        allUsers.set(cleanName, { 
            online: true, 
            lastSeen: new Date(),
            socketId: socket.id 
        });
        
        emitOnlineUsers();
        socket.broadcast.emit("user_joined", cleanName);
    });


    // TYPING INDICATOR - FEATURE
   const typingTimers = new Map();

socket.on("typing",()=>{

    socket.broadcast.emit(
        "typing",
        socket.username
    );

    clearTimeout(
        typingTimers.get(socket.id)
    );

    const timer=setTimeout(()=>{

        socket.broadcast.emit(
            "stop_typing",
            socket.username
        );

    },2000);

    typingTimers.set(
        socket.id,
        timer
    );

});

    // SEND MESSAGE
    socket.on("send_message", (message) => {
        if (!socket.username) {
            socket.emit("error", "You must set a username first");
            return;
        }
        
        message.user = socket.username;
        
        const errors = validateMessage(message);
        if (errors.length > 0) {
            socket.emit("error", errors.join(", "));
            return;
        }
        
        const newMessage = createMessage(message);
        messages.push(newMessage);
        
        if (newMessage.scheduledFor) {
            socket.emit("message_scheduled", {
                id: newMessage.id,
                scheduledFor: newMessage.scheduledFor
            });
        } else {
            io.emit("receive_message", newMessage);
        }
    });

    // LIKE MESSAGE - counts unlimited clicks
    socket.on("like_message", (id) => {
        if (!socket.username) {
            socket.emit("error", "You must set a username first");
            return;
        }
        
        const { errors, msg } = validateVote(id);
        if (errors.length > 0) {
            socket.emit("error", errors.join(", "));
            return;
        }
        
        msg.likes++;
        io.emit("update_message", msg);
    });

    // DISLIKE MESSAGE - counts unlimited clicks
    socket.on("dislike_message", (id) => {
        if (!socket.username) {
            socket.emit("error", "You must set a username first");
            return;
        }
        
        const { errors, msg } = validateVote(id);
        if (errors.length > 0) {
            socket.emit("error", errors.join(", "));
            return;
        }
        
        msg.dislikes++;
        io.emit("update_message", msg);
    });

    // DELETE MESSAGE - only allow deleting own messages
    socket.on("delete_message", (id) => {
        if (!socket.username) {
            socket.emit("error", "You must set a username first");
            return;
        }
        
        const idx = messages.findIndex(m => m.id === id);
        if (idx === -1) {
            socket.emit("error", "Message not found");
            return;
        }
        
        // Only allow user to delete their own messages
        if (messages[idx].user !== socket.username) {
            socket.emit("error", "You can only delete your own messages");
            return;
        }
        
        messages.splice(idx, 1);
        io.emit("message_deleted", id);
    });

    // DISCONNECT - Remove user completely from online list
    socket.on("disconnect", () => {
        if (socket.username && allUsers.has(socket.username)) {
            // Completely remove user from allUsers map when they disconnect
            allUsers.delete(socket.username);
            emitOnlineUsers();
            socket.broadcast.emit("user_left", socket.username);
        }
        console.log("User disconnected:", socket.id);
    });
});

// Error handling
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ success: false, error: "Internal server error" });
});

// PORT CONFIGURATION 
const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});