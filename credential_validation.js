const { GoogleGenerativeAI } = require("@google/generative-ai");
const express = require("express");
const { connectDB } = require("./SIH_DB.js");
const dotenv = require("dotenv");

dotenv.config();

const app = express();
const port = 8080;

// Middleware & Config
app.set("view engine", "pug");
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

// ✅ DB connect wrapper
async function database_connect() {
  try {
    const db = await connectDB();
    console.log("Database connection established");
    return db;
  } catch (error) {
    console.error("Failed to connect to the database:", error);
    throw error;
  }
}

// Test DB connection at startup
database_connect();

/* ----------------- ROUTES ----------------- */

// ✅ LOGIN PAGE
app.get("/", async (req, res) => {
  const message = req.query.message || null;
  res.render("login", { message });
});

// ✅ LOGIN SUBMIT
app.post("/success", async (req, res) => {
  try {
    const { username, password } = req.body;

    const db = await database_connect();
    const collection = db.collection("user_credentials");
    const existingUser = await collection.findOne({ username });

    if (!existingUser) {
      console.log("USER NOT FOUND");
      return res
        .status(400)
        .render("login", { message: "User does not exist" });
    }

    if (existingUser.password !== password) {
      console.log("INCORRECT PASSWORD");
      return res
        .status(400)
        .render("login", { message: "Incorrect password" });
    }

    console.log("USER LOGGED IN");

    if (existingUser.firstTimeUser) {
      return res.redirect(
        `/questions?username=${encodeURIComponent(username)}`
      );
    } else {
      return res.redirect(`/home?username=${encodeURIComponent(username)}`);
    }
  } catch (err) {
    console.error("LOGIN ERROR:", err.message);
    res
      .status(500)
      .render("login", { message: "Something went wrong. Try again." });
  }
});

// ✅ SIGNUP PAGE
app.get("/user", (req, res) => {
  res.render("signup");
});

// ✅ SIGNUP SUBMIT
app.post("/user_success", async (req, res) => {
  const { username, password, email } = req.body;

  const db = await database_connect();
  const collection = db.collection("user_credentials");

  const existingUser = await collection.findOne({ username });
  if (existingUser) {
    return res.redirect(
      "/?message=" +
        encodeURIComponent("USERNAME ALREADY EXISTS, PLEASE LOGIN")
    );
  }

  await collection.insertOne({
    username,
    password,
    email,
    firstTimeUser: true,
  });

  return res.redirect(
    "/?message=" +
      encodeURIComponent("USER REGISTERED SUCCESSFULLY, PLEASE LOGIN")
  );
});

// ✅ QUESTIONS PAGE
app.get("/questions", async (req, res) => {
  const username = req.query.username;
  
  if (!username)
    return res.redirect(
      "/?message=" + encodeURIComponent("Invalid access")
    );

  const db = await database_connect();
  const collection = db.collection("user_credentials");
  const user = await collection.findOne({ username });

  if (!user) {
    return res.redirect("/?message=" + encodeURIComponent("User not found"));
  }

  if (!user.firstTimeUser) {
    return res.redirect(`/home?username=${encodeURIComponent(username)}`);
  }

  res.render("questions", { username });
});

// ✅ QUESTIONS ANALYSIS
// ✅ QUESTIONS ANALYSIS
app.post("/questions_analysis", async (req, res) => {
  const { username, answers } = req.body;

  if (!answers || !answers.length) {
    return res.status(400).json({ error: "No answers provided" });
  }

  try {
    const db = await database_connect();
    const collection = db.collection("user_credentials");

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const result = await model.generateContent({
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `Please analyze these PHQ-9 answers and give a compassionate psychological response in around 6-7 words:\n${JSON.stringify(
                answers,
                null,
                2
              )}`,
            },
          ],
        },
      ],
    });

    const reply = result.response.text();

    // ✅ Update user: save answers + AI reply + mark as not first time
    await collection.updateOne(
      { username: username },
      {
        $set: { firstTimeUser: false },
        $push: {
          assessments: {
            date: new Date(),
            answers: answers,
            aiReply: reply,
          },
        },
      }
    );

    res.json({ reply });
  } catch (err) {
    console.error("Gemini error:", err);
    res.status(500).json({ error: "Something went wrong" });
  }
});

// ✅ HOME PAGE
app.get("/home", async (req, res) => {
  const username = req.query.username;
  if (!username) {
    return res.redirect("/?message=" + encodeURIComponent("Invalid access"));
  }

  try {
    const db = await database_connect();
    const collection = db.collection("user_credentials");

    const user = await collection.findOne({ username });
    if (!user) {
      return res.redirect("/?message=" + encodeURIComponent("User not found"));
    }

    // Update firstTimeUser to false (safety check)
    await collection.updateOne(
      { username },
      { $set: { firstTimeUser: false } }
    );

    res.render("home", { username });
  } catch (err) {
    console.error("Error updating firstTimeUser:", err);
    res
      .status(500)
      .render("login", { message: "Something went wrong. Try again." });
  }
});

// ✅ ADMIN PAGE
app.get("/admin", (req, res) => {
  res.render("admin");
});

// ✅ START SERVER
app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
