const socket = io("https://ho9d1ruaqtcgefkqiyqdctch.178.105.39.91.sslip.io")

// DOM Elements
const usernameInput = document.getElementById("username");
const usersList = document.getElementById("usersList");
const messagesContainer = document.getElementById("messages");
const typingIndicator = document.getElementById("typingIndicator");
const colorPicker = document.getElementById("colorPicker");
const messageInput = document.getElementById("messageInput");
const scheduleTime = document.getElementById("scheduleTime");
const sendBtn = document.getElementById("sendBtn");

// State
let currentUsername = "";
let replyToId = null;
let typingUsers = new Set();

// INITIALIZATION 

document.addEventListener("DOMContentLoaded", () => {
    const saved = localStorage.getItem("chat_username");
    if (saved) {
        usernameInput.value = saved;
        setUsername(saved);
    } else {
        usernameInput.focus();
    }
});

// USERNAME 

usernameInput.addEventListener("change", () => {
    const name = usernameInput.value.trim();
    if (name) {
        setUsername(name);
        localStorage.setItem("chat_username", name);
    }
});

function setUsername(name) {
    currentUsername = name;
    socket.emit("join", name);
}

// COLOR PICKER 

colorPicker.addEventListener("change", (e) => {
    socket.emit("update_color", e.target.value);
});

// TYPING INDICATOR 

messageInput.addEventListener("input", () => {
    if (!currentUsername) return;
    socket.emit("typing");
});

// SEND MESSAGE 

sendBtn.addEventListener("click", (e) => {
    e.preventDefault();
    sendMessage();
});

messageInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

function sendMessage() {
    const text = messageInput.value.trim();
    if (!text) return;

    if (!currentUsername) {
        alert("Please enter a username first");
        usernameInput.focus();
        return;
    }

    const payload = {
        text: text,
        color: colorPicker.value,
        replyTo: replyToId
    };

    if (scheduleTime.value) {
        payload.scheduledFor = new Date(scheduleTime.value).toISOString();
    }

    socket.emit("send_message", payload);

    messageInput.value = "";
    scheduleTime.value = "";
    clearReply();
}

// REPLY FUNCTIONALITY 
function setReply(messageId) {
    replyToId = messageId;
    renderReplyIndicator();
    messageInput.focus();
}

function clearReply() {
    replyToId = null;
    renderReplyIndicator();
}

function renderReplyIndicator() {
    const existing = document.querySelector(".reply-indicator");
    if (existing) existing.remove();

    if (!replyToId) return;

    const msg = document.querySelector(`[data-id="${replyToId}"]`);
    if (!msg) return;

    const text = msg.querySelector(".message-text").textContent;
    const indicator = document.createElement("div");
    indicator.className = "reply-indicator";
    indicator.innerHTML = `
        <span>↩️ Replying to: <strong>${escapeHtml(text.substring(0, 40))}${text.length > 40 ? "..." : ""}</strong></span>
        <button onclick="clearReply()" aria-label="Cancel reply">✕</button>
    `;

    const inputSection = document.querySelector(".message-input-section");
    inputSection.parentNode.insertBefore(indicator, inputSection);
}

// VOTE (UNLIMITED CLICKS) 

function likeMessage(id) {
    if (!currentUsername) {
        alert("Please enter a username first");
        return;
    }
    socket.emit("like_message", id);
}

function dislikeMessage(id) {
    if (!currentUsername) {
        alert("Please enter a username first");
        return;
    }
    socket.emit("dislike_message", id);
}

// DELETE (OWN MESSAGES ONLY) 

function deleteMessage(id) {
    if (!confirm("Delete this message?")) return;
    socket.emit("delete_message", id);
}

// SOCKET EVENTS 

socket.on("connect", () => {
    console.log("Connected to server");
    if (currentUsername) {
        socket.emit("join", currentUsername);
    }
});

socket.on("load_messages", (msgs) => {
    messagesContainer.innerHTML = "";
    msgs.forEach(msg => appendMessage(msg));
    scrollToBottom();
});

socket.on("receive_message", (msg) => {
    appendMessage(msg);
    scrollToBottom();
});

socket.on("update_message", (msg) => {
    updateMessageDisplay(msg);
});

socket.on("message_deleted", (id) => {
    const el = document.querySelector(`[data-id="${id}"]`);
    if (el) {
        el.style.opacity = "0";
        el.style.transform = "translateX(-20px)";
        setTimeout(() => el.remove(), 300);
    }
});

// ONLY ONLINE USERS - offline users disappear completely
socket.on("online_users", (users) => {
    if (users.length === 0) {
        usersList.innerHTML = '<li style="opacity:0.5; font-style:italic;">No users online</li>';
        return;
    }
    usersList.innerHTML = users.map(u => 
        `<li class="online">${escapeHtml(u.name)}</li>`
    ).join("");
});

socket.on("user_joined", (username) => {
    showSystemMessage(`${escapeHtml(username)} joined the chat`);
});

socket.on("user_left", (username) => {
    showSystemMessage(`${escapeHtml(username)} left the chat`);
});

socket.on("typing", (username) => {
    typingUsers.add(username);
    updateTypingDisplay();
});

socket.on("stop_typing", (username) => {
    typingUsers.delete(username);
    updateTypingDisplay();
});

socket.on("error", (err) => {
    console.error("Server error:", err);
    showToast("Error: " + err, "error");
});

socket.on("message_scheduled", (data) => {
    showToast(`Message scheduled for ${new Date(data.scheduledFor).toLocaleString()}`);
});

//  RENDERING 

function appendMessage(msg) {
    const isOwn = msg.user === currentUsername;
    const isScheduled = msg.scheduledFor && !msg.delivered;

    const div = document.createElement("div");
    div.className = `message ${isOwn ? "own" : "other"} ${isScheduled ? "scheduled" : ""}`;
    div.dataset.id = msg.id;

    let html = "";

    // Reply reference
    if (msg.replyTo) {
        const parent = document.querySelector(`[data-id="${msg.replyTo}"]`);
        const parentText = parent 
            ? parent.querySelector(".message-text").textContent 
            : "...";
        html += `
            <div class="reply-box">
                <div class="reply-label">↩️ Reply</div>
                <div>${escapeHtml(parentText.substring(0, 60))}${parentText.length > 60 ? "..." : ""}</div>
            </div>
        `;
    }

    // Header
    const time = new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const scheduledBadge = msg.scheduledFor 
        ? ` ⏰ ${new Date(msg.scheduledFor).toLocaleString()}` 
        : "";

    html += `
        <div class="message-header">
            <span class="username" style="color: ${msg.color}">${escapeHtml(msg.user)}</span>
            <span class="time">${time}${scheduledBadge}</span>
        </div>
    `;

    // Text
    html += `<div class="message-text">${msg.formattedText || escapeHtml(msg.text)}</div>`;

    // Actions - ONLY show delete button for OWN messages
    html += `
        <div class="reactions">
            <button class="like-btn" onclick="likeMessage(${msg.id})" title="Like">
                👍 ${msg.likes}
            </button>
            <button class="dislike-btn" onclick="dislikeMessage(${msg.id})" title="Dislike">
                👎 ${msg.dislikes}
            </button>
            <button class="reply-btn" onclick="setReply(${msg.id})" title="Reply">
                ↩️ Reply
            </button>
            ${isOwn ? `<button class="delete-btn" onclick="deleteMessage(${msg.id})" title="Delete">🗑️ Delete</button>` : ""}
        </div>
    `;

    div.innerHTML = html;
    messagesContainer.appendChild(div);
}

function updateMessageDisplay(msg) {
    const existing = document.querySelector(`[data-id="${msg.id}"]`);
    if (!existing) return;

    const likeBtn = existing.querySelector(".like-btn");
    const dislikeBtn = existing.querySelector(".dislike-btn");

    if (likeBtn) {
        likeBtn.innerHTML = `👍 ${msg.likes}`;
    }
    if (dislikeBtn) {
        dislikeBtn.innerHTML = `👎 ${msg.dislikes}`;
    }
}

function updateTypingDisplay() {
    if (typingUsers.size === 0) {
        typingIndicator.textContent = "";
        return;
    }
    const users = Array.from(typingUsers);
    if (users.length === 1) {
        typingIndicator.textContent = `${users[0]} is typing...`;
    } else if (users.length === 2) {
        typingIndicator.textContent = `${users[0]} and ${users[1]} are typing...`;
    } else {
        typingIndicator.textContent = `${users.length} people are typing...`;
    }
}

function showSystemMessage(text) {
    const div = document.createElement("div");
    div.className = "system-message";
    div.textContent = text;
    messagesContainer.appendChild(div);
    scrollToBottom();
}

function showToast(message, type = "info") {
    const toast = document.createElement("div");
    const bgColor = type === "error" ? "#ef4444" : "#2563eb";
    toast.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: ${bgColor};
        color: white;
        padding: 12px 20px;
        border-radius: 10px;
        z-index: 1000;
        animation: fadeIn 0.3s ease;
        font-size: 14px;
        font-weight: 500;
        box-shadow: 0 8px 20px rgba(0,0,0,0.3);
    `;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = "0";
        toast.style.transform = "translateX(20px)";
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function scrollToBottom() {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}

// GLOBAL EXPORTS 

window.likeMessage = likeMessage;
window.dislikeMessage = dislikeMessage;
window.setReply = setReply;
window.clearReply = clearReply;
window.deleteMessage = deleteMessage;