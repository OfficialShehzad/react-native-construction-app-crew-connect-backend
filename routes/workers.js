import express from "express";
import dbPromise from "../db.js";
import { authenticateToken } from "../middleware/auth.js";

const router = express.Router();

// Get worker requests (for workers)
router.get("/requests", authenticateToken, async (req, res) => {
  if (req.user.user_type !== 'worker') {
    return res.status(403).json({ error: "Only workers can view requests" });
  }

  try {
    const db = await dbPromise;
    const requests = await db.all(
      `SELECT wr.*, p.name as project_name, p.description as project_description, 
              p.budget, u.username as requested_by_name
       FROM worker_requests wr
       JOIN projects p ON wr.project_id = p.id
       JOIN users u ON wr.requested_by = u.id
       WHERE wr.worker_id = ?
       ORDER BY wr.created_at DESC`,
      req.user.id
    );
    res.json(requests);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Respond to worker request
router.put("/requests/:id/respond", authenticateToken, async (req, res) => {
  if (req.user.user_type !== 'worker') {
    return res.status(403).json({ error: "Only workers can respond to requests" });
  }

  try {
    const { status } = req.body; // 'accepted' or 'rejected'
    const db = await dbPromise;
    
    // Get the request
    const request = await db.get(
      "SELECT * FROM worker_requests WHERE id = ? AND worker_id = ?",
      req.params.id, req.user.id
    );
    
    if (!request) {
      return res.status(404).json({ error: "Request not found" });
    }
    
    if (request.status !== 'pending') {
      return res.status(400).json({ error: "Request already responded to" });
    }

    await db.run("BEGIN TRANSACTION");

    try {
      // Update request status
      await db.run(
        "UPDATE worker_requests SET status = ?, responded_at = CURRENT_TIMESTAMP WHERE id = ?",
        [status, req.params.id]
      );

      if (status === 'accepted') {
        // Update project with civil engineer
        await db.run(
          "UPDATE projects SET civil_engineer_id = ?, status = 'in_progress' WHERE id = ?",
          [req.user.id, request.project_id]
        );
        
        // Add worker to project_workers
        await db.run(
          "INSERT INTO project_workers (project_id, worker_id, assigned_by, role) VALUES (?, ?, ?, ?)",
          [request.project_id, req.user.id, req.user.id, 'civil_engineer']
        );
        
        // Mark worker as unavailable
        await db.run(
          "UPDATE users SET is_available = 0 WHERE id = ?",
          req.user.id
        );
      }

      await db.run("COMMIT");
      res.json({ message: `Request ${status} successfully` });
    } catch (error) {
      await db.run("ROLLBACK");
      throw error;
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get the user's sent request
router.get("/worker_requests", authenticateToken, async (req, res) => {
  try {
    const db = await dbPromise;
    const requests = await db.all(
      `SELECT * FROM worker_requests WHERE requested_by = ?`,
      req.user.id
    );
    res.json(requests);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
})

// Get available workers (for civil engineers to assign)
router.get("/available", authenticateToken, async (req, res) => {
  console.log('fetching available workers')
  if (req.user.user_type !== 'worker' || req.user.sub_user_type !== 'civil_engineer') {
    return res.status(403).json({ error: "Only civil engineers can view available workers" });
  }

  try {
    const db = await dbPromise;
    const workers = await db.all(
      `SELECT id, username, email, sub_user_type FROM users 
       WHERE user_type = 'worker' AND is_available = 1 AND id != ?`,
      req.user.id
    );
    res.json(workers);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Assign worker to project (civil engineer only)
router.post("/assign", authenticateToken, async (req, res) => {
  if (req.user.user_type !== 'worker' || req.user.sub_user_type !== 'civil_engineer') {
    return res.status(403).json({ error: "Only civil engineers can assign workers" });
  }

  try {
    const { project_id, worker_id, role } = req.body;
    const db = await dbPromise;
    
    // Check if civil engineer is assigned to this project
    const project = await db.get(
      "SELECT * FROM projects WHERE id = ? AND civil_engineer_id = ?",
      project_id, req.user.id
    );
    
    if (!project) {
      return res.status(403).json({ error: "Not authorized for this project" });
    }

    // Check if worker is available
    const worker = await db.get(
      "SELECT * FROM users WHERE id = ? AND user_type = 'worker' AND is_available = 1",
      worker_id
    );
    
    if (!worker) {
      return res.status(400).json({ error: "Worker not available" });
    }

    await db.run("BEGIN TRANSACTION");

    try {
      // Add worker to project
      await db.run(
        "INSERT INTO project_workers (project_id, worker_id, assigned_by, role) VALUES (?, ?, ?, ?)",
        [project_id, worker_id, req.user.id, role || worker.sub_user_type]
      );
      
      // Mark worker as unavailable
      await db.run(
        "UPDATE users SET is_available = 0 WHERE id = ?",
        worker_id
      );

      await db.run("COMMIT");
      res.json({ message: "Worker assigned successfully" });
    } catch (error) {
      await db.run("ROLLBACK");
      throw error;
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get project workers
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

    const workers = await db.all(
      `SELECT pw.*, u.username, u.email, u.sub_user_type
       FROM project_workers pw
       JOIN users u ON pw.worker_id = u.id
       WHERE pw.project_id = ?
       ORDER BY pw.assigned_at DESC`,
      req.params.projectId
    );
    
    res.json(workers);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
