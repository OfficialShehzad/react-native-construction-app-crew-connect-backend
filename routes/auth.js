import express from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import dbPromise from "../db.js";
import { authenticateToken } from "../middleware/auth.js";

dotenv.config();
const router = express.Router();

// REGISTER
router.post("/register", async (req, res) => {
  console.log('register api called');
  const { username, email, password, user_type, sub_user_type } = req.body;

  if (!username || !email || !password || !user_type) {
    return res
      .status(400)
      .json({ error: "Username, email, password, and user_type are required" });
  }

  const db = await dbPromise;

  try {
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert user, sub_user_type will be NULL if not provided
    await db.run(
      `INSERT INTO users (username, email, password, user_type, sub_user_type) 
       VALUES (?, ?, ?, ?, ?)`,
      [username, email, hashedPassword, user_type, sub_user_type || null]
    );

    res.json({ message: "User registered successfully" });
  } catch (err) {
    console.error(err);
    if (err.message.includes("UNIQUE constraint failed")) {
      res.status(400).json({ error: "Username or email already exists" });
    } else if (err.message.includes("CHECK constraint failed")) {
      res.status(400).json({
        error:
          "Invalid user_type or sub_user_type. Please use allowed values only.",
      });
    } else {
      res.status(500).json({ error: "Something went wrong" });
    }
  }
});


// LOGIN
router.post("/login", async (req, res) => {
  console.log('inside the login route')
  const { username, password, user_type } = req.body;
  const db = await dbPromise;

  // Validate required fields
  if (!username || !password || !user_type) {
    return res.status(400).json({ error: "Username, password, and user_type are required" });
  }
  
  console.log('here1')
  
  // Validate user_type is one of the allowed values
  const allowedUserTypes = ['user', 'admin', 'worker'];
  if (!allowedUserTypes.includes(user_type)) {
    return res.status(400).json({ error: "Invalid user_type. Must be 'user', 'admin', or 'worker'" });
  }

  const user = await db.get("SELECT * FROM users WHERE username = ?", [username]);
  if (!user) return res.status(400).json({ error: "Invalid credentials" });

  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.status(400).json({ error: "Invalid credentials" });

  // Validate user_type matches the registered user type
  if (user.user_type !== user_type) {
    return res.status(400).json({ 
      error: `Invalid user type. This account is registered as '${user.user_type}', not '${user_type}'` 
    });
  }

  const token = jwt.sign({ 
    id: user.id, 
    username: user.username, 
    user_type: user.user_type 
  }, process.env.JWT_SECRET, {
    expiresIn: "1h",
  });

  res.json({ 
    token,
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      user_type: user.user_type,
      sub_user_type: user.sub_user_type
    }
  });
});

// GET current user info
router.get("/me", authenticateToken, async (req, res) => {
  try {
    const db = await dbPromise;
    const user = await db.get("SELECT id, username, email, user_type, sub_user_type FROM users WHERE id = ?", req.user.id);
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// LOGOUT (client just deletes token, but we can add blacklist if needed)
router.post("/logout", (req, res) => {
  // For JWT, logout is usually client-side (delete token)
  res.json({ message: "Logged out successfully" });
});

export default router;
