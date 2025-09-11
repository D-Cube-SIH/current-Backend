require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { connectDB } = require('./SIH_DB.js');

const app = express();
const port = process.env.PORT || 8080;
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

app.set('view engine', 'pug');
app.set('views', path.join(__dirname, 'views'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

async function database_connect() {
  try {
    const db = await connectDB();
    console.log('Database connection established');
    return db;
  } catch (error) {
    console.error('Failed to connect to the database:', error);
    throw error;
  }
}

database_connect().catch(() => { /* handled per-route */ });

const server = http.createServer(app);
const io = new Server(server);
const rooms = new Map();

function broadcastRoomList() {
  const roomList = Array.from(rooms.entries()).map(([roomId, room]) => ({
    roomId,
    userCount: Object.keys(room.users).length
  }));
  io.emit('room-list', roomList);
}

io.on('connection', (socket) => {
  console.log('Socket connected:', socket.id);

  socket.on('get-room-list', () => {
    broadcastRoomList();
  });

  socket.on('join-room', ({ roomId }) => {
    if (!roomId) return;
    socket.join(roomId);

    let room = rooms.get(roomId);
    if (!room) {
      room = { users: {}, counter: 1 };
      rooms.set(roomId, room);
    }
    const anonName = `Peer ${room.counter++}`;
    room.users[socket.id] = anonName;

    // Notify others in the room
    socket.to(roomId).emit('user-connected', {
      username: anonName,
      timestamp: new Date().toISOString()
    });

    // Send participants list to everyone in room
    io.in(roomId).emit('participants', {
      participants: Object.values(room.users)
    });

    // Ack to the joining user with their anonymous name and participant list
    socket.emit('joined', { roomId, anonName, participants: Object.values(room.users), socketId: socket.id });

    console.log(`${anonName} joined room ${roomId}`);
    broadcastRoomList();
  });

  socket.on('send-message', ({ roomId, text }) => {
    if (!roomId || !text) return;
    const room = rooms.get(roomId);
    if (!room) return;
    const anonName = room.users[socket.id];
    if (!anonName) return;
    const message = {
      fromSocketId: socket.id,
      username: anonName,
      text,
      timestamp: new Date().toISOString()
    };
    // Broadcast to others in the room (exclude sender)
    socket.to(roomId).emit('new-message', message);
  });

  socket.on('disconnect', () => {
    for (const [roomId, room] of rooms.entries()) {
      const users = room.users;
      if (users[socket.id]) {
        const anonName = users[socket.id];
        delete users[socket.id];

        socket.to(roomId).emit('user-disconnected', {
          username: anonName,
          timestamp: new Date().toISOString()
        });

        io.in(roomId).emit('participants', { participants: Object.values(users) });

        if (Object.keys(users).length === 0) rooms.delete(roomId);

        console.log(`${anonName} disconnected from ${roomId}`);
      }
    }
    broadcastRoomList();
  });
});

// Routes
app.get('/', async (req, res) => {
  const message = req.query.message || null;
  res.render('login', { message });
});

app.post('/success', async (req, res) => {
  try {
    const { username, password } = req.body;
    const db = await database_connect();
    const collection = db.collection('user_credentials');
    const existingUser = await collection.findOne({ username });

    if (!existingUser) {
      return res.status(400).render('login', { message: 'User does not exist' });
    }
    if (existingUser.password !== password) {
      return res.status(400).render('login', { message: 'Incorrect password' });
    }

    if (existingUser.firstTimeUser) {
      return res.redirect(`/questions?username=${encodeURIComponent(username)}`);
    } else {
      return res.redirect(`/home?username=${encodeURIComponent(username)}`);
    }
  } catch (err) {
    console.error('LOGIN ERROR:', err.message);
    res.status(500).render('login', { message: 'Something went wrong. Try again.' });
  }
});

app.get('/user', (req, res) => res.render('signup'));

app.post('/user_success', async (req, res) => {
  const { username, password, email } = req.body;
  const db = await database_connect();
  const collection = db.collection('user_credentials');

  const existingUser = await collection.findOne({ username });
  if (existingUser) {
    return res.redirect('/?message=' + encodeURIComponent('USERNAME ALREADY EXISTS, PLEASE LOGIN'));
  }

  await collection.insertOne({
    username,
    password,
    email,
    firstTimeUser: true
  });

  return res.redirect('/?message=' + encodeURIComponent('USER REGISTERED SUCCESSFULLY, PLEASE LOGIN'));
});

app.get('/questions', async (req, res) => {
  const username = req.query.username;
  if (!username) return res.redirect('/?message=' + encodeURIComponent('Invalid access'));

  const db = await database_connect();
  const collection = db.collection('user_credentials');
  const user = await collection.findOne({ username });

  if (!user) return res.redirect('/?message=' + encodeURIComponent('User not found'));
  if (!user.firstTimeUser) return res.redirect(`/home?username=${encodeURIComponent(username)}`);

  res.render('questions', { username });
});

app.post('/questions_analysis', async (req, res) => {
  const { username, answers } = req.body;
  if (!answers || !answers.length) {
    return res.status(400).json({ error: 'No answers provided' });
  }

  try {
    const db = await database_connect();
    const collection = db.collection('user_credentials');

    const result = await model.generateContent({
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: `Please analyze these PHQ-9 answers and give a compassionate psychological response in around 6-7 words:\n${JSON.stringify(
                answers,
                null,
                2
              )}`
            }
          ]
        }
      ]
    });

    const reply = result.response.text();

    await collection.updateOne(
      { username },
      {
        $set: { firstTimeUser: false },
        $push: { assessments: { date: new Date(), answers, aiReply: reply } }
      }
    );

    res.redirect(`/home?username=${encodeURIComponent(username)}`);
  } catch (err) {
    console.error('Gemini error:', err);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

app.get('/home', async (req, res) => {
  const username = req.query.username;
  if (!username) return res.redirect('/?message=' + encodeURIComponent('Invalid access'));

  try {
    const db = await database_connect();
    const collection = db.collection('user_credentials');
    const user = await collection.findOne({ username });

    if (!user) return res.redirect('/?message=' + encodeURIComponent('User not found'));
    await collection.updateOne({ username }, { $set: { firstTimeUser: false } });

    res.render('index', { username });
  } catch (err) {
    console.error('Error updating firstTimeUser:', err);
    res.status(500).render('login', { message: 'Something went wrong. Try again.' });
  }
});

app.get('/admin', (req, res) => res.render('admin'));

app.get('/chat_support', (req, res) => {
  const username = req.query.username;
  if (!username) return res.redirect('/?message=' + encodeURIComponent('Invalid access'));

  try {
    res.render('chatbot', {
      title: 'Chat Support',
      message: 'Hi, How can I help you today?',
      username
    });
  } catch (err) {
    console.error('Error rendering chatbot:', err);
    res.status(500).send('Something went wrong loading the chat support page.');
  }
});

app.post('/chat', async (req, res) => {
  const userInput = req.body.userInput;
  if (!userInput) return res.status(400).json({ error: 'userInput is required' });

  try {
    const result = await model.generateContent({
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: `${userInput}

              Take the user's input above and respond as a supportive chatbot. Keep answers short, clear, and motivating, with a positive and encouraging tone. Focus on actionable steps and uplifting guidance instead of long explanations.

              If the input contains any mention of self-harm or suicide, do not continue the conversation. Instead, reply only with:

              "I'm really sorry you're feeling this way. I cannot help with that, but you can call the suicide prevention helpline in India at 9152987821 (Vandrevala Foundation) or 1800-599-0019 (KIRAN). You are not alone. and attach the link as such http://localhost:8080/peer_support and explain the link as a link that helps them to get the help they want"`
            }
          ]
        }
      ]
    });

    res.json({ reply: result.response.text() });
  } catch (err) {
    console.error('Gemini error:', err);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

app.get('/peer_support', (req, res) => {
  const username = req.query.username || 'Guest';
  const room = req.query.room || null;
  res.render('peer', { username, room });
});

app.get('/resources', (req, res) => {
  const username = req.query.username || 'Guest';
  res.render('resources', { username });
});

app.get('/rooms', (req, res) => {
  const username = req.query.username || 'Guest';
  res.render('rooms', { username });
});

server.listen(port, () => {
  console.log(`🚀 Server running at http://localhost:${port}`);
});