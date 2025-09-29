import express from "express";
import dbPromise from "../db.js";
import { authenticateToken } from "../middleware/auth.js";

const router = express.Router();

// Get project milestones
router.get("/project/:projectId", authenticateToken, async (req, res) => {
  try {
    const db = await dbPromise;
    
    // Check if user has access to this project
    const project = await db.get("SELECT * FROM projects WHERE id = ?", req.params.projectId);
    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }
    
    if (req.user.user_type === 'user' && project.created_by !== req.user.id) {
      return res.status(403).json({ error: "Not authorized" });
    }
    
    if (req.user.user_type === 'worker' && project.civil_engineer_id !== req.user.id) {
      const workerInProject = await db.get(
        "SELECT * FROM project_workers WHERE project_id = ? AND worker_id = ?",
        req.params.projectId, req.user.id
      );
      if (!workerInProject) {
        return res.status(403).json({ error: "Not authorized" });
      }
    }

    const milestones = await db.all(
      `SELECT pm.*, u.username as created_by_name
       FROM project_milestones pm
       JOIN users u ON pm.created_by = u.id
       WHERE pm.project_id = ?
       ORDER BY pm.target_date ASC`,
      req.params.projectId
    );
    
    res.json(milestones);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create milestone (civil engineer only)
router.post("/", authenticateToken, async (req, res) => {
  try {
    const { project_id, title, description, target_date } = req.body;
    const db = await dbPromise;
    
    // Check if civil engineer is assigned to this project
    const project = await db.get(
      "SELECT * FROM projects WHERE id = ? AND civil_engineer_id = ?",
      project_id, req.user.id
    );
    
    if (!project) {
      return res.status(403).json({ error: "Not authorized for this project" });
    }

    const result = await db.run(
      `INSERT INTO project_milestones (project_id, title, description, target_date, created_by)
       VALUES (?, ?, ?, ?, ?)`,
      [project_id, title, description, target_date, req.user.id]
    );

    const milestone = await db.get("SELECT * FROM project_milestones WHERE id = ?", result.lastID);
    res.status(201).json(milestone);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update milestone (civil engineer only)
router.put("/:id", authenticateToken, async (req, res) => {
  if (req.user.user_type !== 'worker' || req.user.sub_user_type !== 'civil_engineer') {
    return res.status(403).json({ error: "Only civil engineers can update milestones" });
  }

  try {
    const { title, description, target_date, status, completion_date } = req.body;
    const db = await dbPromise;
    
    // Get milestone and check authorization
    const milestone = await db.get("SELECT * FROM project_milestones WHERE id = ?", req.params.id);
    if (!milestone) {
      return res.status(404).json({ error: "Milestone not found" });
    }

    const project = await db.get(
      "SELECT * FROM projects WHERE id = ? AND civil_engineer_id = ?",
      milestone.project_id, req.user.id
    );
    
    if (!project) {
      return res.status(403).json({ error: "Not authorized for this project" });
    }

    await db.run(
      `UPDATE project_milestones SET title = ?, description = ?, target_date = ?, 
       status = ?, completion_date = ?
       WHERE id = ?`,
      [title, description, target_date, status, completion_date, req.params.id]
    );

    const updatedMilestone = await db.get("SELECT * FROM project_milestones WHERE id = ?", req.params.id);
    res.json(updatedMilestone);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete milestone (civil engineer only)
router.delete("/:id", authenticateToken, async (req, res) => {
  if (req.user.user_type !== 'worker' || req.user.sub_user_type !== 'civil_engineer') {
    return res.status(403).json({ error: "Only civil engineers can delete milestones" });
  }

  try {
    const db = await dbPromise;
    
    // Get milestone and check authorization
    const milestone = await db.get("SELECT * FROM project_milestones WHERE id = ?", req.params.id);
    if (!milestone) {
      return res.status(404).json({ error: "Milestone not found" });
    }

    const project = await db.get(
      "SELECT * FROM projects WHERE id = ? AND civil_engineer_id = ?",
      milestone.project_id, req.user.id
    );
    
    if (!project) {
      return res.status(403).json({ error: "Not authorized for this project" });
    }

    await db.run("DELETE FROM project_milestones WHERE id = ?", req.params.id);
    res.json({ message: "Milestone deleted successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Mark milestone as completed
router.put("/:id/complete", authenticateToken, async (req, res) => {
  if (req.user.user_type !== 'worker' || req.user.sub_user_type !== 'civil_engineer') {
    return res.status(403).json({ error: "Only civil engineers can complete milestones" });
  }

  try {
    const db = await dbPromise;
    
    // Get milestone and check authorization
    const milestone = await db.get("SELECT * FROM project_milestones WHERE id = ?", req.params.id);
    if (!milestone) {
      return res.status(404).json({ error: "Milestone not found" });
    }

    const project = await db.get(
      "SELECT * FROM projects WHERE id = ? AND civil_engineer_id = ?",
      milestone.project_id, req.user.id
    );
    
    if (!project) {
      return res.status(403).json({ error: "Not authorized for this project" });
    }

    await db.run(
      `UPDATE project_milestones SET status = 'completed', completion_date = CURRENT_DATE
       WHERE id = ?`,
      req.params.id
    );

    const updatedMilestone = await db.get("SELECT * FROM project_milestones WHERE id = ?", req.params.id);
    res.json(updatedMilestone);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
