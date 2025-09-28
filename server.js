import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import authRoutes from "./routes/auth.js";
import projectRoutes from "./routes/projects.js";
import workerRoutes from "./routes/workers.js";
import materialRoutes from "./routes/materials.js";
import milestoneRoutes from "./routes/milestones.js";
import { authenticateToken } from "./middleware/auth.js";

dotenv.config();
const app = express();

app.use(cors({
  origin: ['http://localhost:8081', 'http://10.184.244.166:8081', 'exp://10.184.244.166:8081'],
  credentials: true
})); // allow React Native requests
app.use(express.json());

console.log('inside server.js')

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/projects", projectRoutes);
app.use("/api/workers", workerRoutes);
app.use("/api/materials", materialRoutes);
app.use("/api/milestones", milestoneRoutes);

// Example protected route
app.get("/api/profile", authenticateToken, (req, res) => {
  res.json({ message: "This is a protected profile route", user: req.user });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Accessible at: http://localhost:${PORT}`);
  console.log(`Network accessible at: http://10.184.244.166:${PORT}`);
});
