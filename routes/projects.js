import express from "express";
import multer from "multer";
import dbPromise from "../db.js";
import { authenticateToken } from "../middleware/auth.js";

const router = express.Router();

// Configure multer for memory storage
const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  }
});

// Get all projects (for admin) or user's projects
router.get("/", authenticateToken, async (req, res) => {
  try {
    console.log('trying projects get')
    const db = await dbPromise;
    let query = `
      SELECT p.*, u.username as created_by_name, ce.username as civil_engineer_name
      FROM projects p
      LEFT JOIN users u ON p.created_by = u.id
      LEFT JOIN users ce ON p.civil_engineer_id = ce.id
    `;
    let params = [];

    if (req.user.user_type === 'user') {
      query += " WHERE p.created_by = ?";
      params.push(req.user.id);
    } else if (req.user.user_type === 'worker') {
      query += ` WHERE p.id IN (
        SELECT DISTINCT project_id FROM project_workers WHERE worker_id = ?
        UNION
        SELECT DISTINCT project_id FROM worker_requests WHERE worker_id = ? AND status = 'accepted'
      )`;
      params.push(req.user.id, req.user.id);
    }

    query += " ORDER BY p.created_at DESC";
    
    const projects = await db.all(query, params);
    
    // Convert BLOB to base64 for each project that has an image
    const projectsWithImages = projects.map(project => {
      if (project.plan_image) {
        return {
          ...project,
          plan_image_url: `data:${project.plan_image_type};base64,${project.plan_image.toString('base64')}`
        };
      }
      return project;
    });
    
    res.json(projectsWithImages);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create new project (users only) - Updated to handle image upload
router.post("/", authenticateToken, upload.single('plan_image'), async (req, res) => {
  console.log('inside projects route', req)
  if (req.user.user_type !== 'user') {
    return res.status(403).json({ error: "Only users can create projects" });
  }

  try {
    console.log('trying to create a project', req.user)

    const { name, description, budget, start_date, end_date } = req.body;
    let plan_image = null;
    let plan_image_type = null;

    // Handle uploaded image
    if (req.file) {
      plan_image = req.file.buffer;
      plan_image_type = req.file.mimetype;
    }

    console.log({ name, description, budget, start_date, end_date, hasImage: !!req.file })
    const db = await dbPromise;
    
    const result = await db.run(
      `INSERT INTO projects (name, description, budget, plan_image, plan_image_type, start_date, end_date, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [name, description, budget, plan_image, plan_image_type, start_date, end_date, req.user.id]
    );

    const project = await db.get("SELECT * FROM projects WHERE id = ?", result.lastID);
    
    // Convert BLOB to base64 for response
    if (project.plan_image) {
      project.plan_image_url = `data:${project.plan_image_type};base64,${project.plan_image.toString('base64')}`;
    }
    
    res.status(201).json(project);
  } catch (error) {
    console.error('Error creating project:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update project - Updated to handle image upload
router.put("/:id", authenticateToken, upload.single('plan_image'), async (req, res) => {
  try {
    const { name, description, budget, start_date, end_date, status } = req.body;
    const db = await dbPromise;
    
    // Check if user owns the project or is admin
    const project = await db.get("SELECT * FROM projects WHERE id = ?", req.params.id);
    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }
    
    if (req.user.user_type !== 'admin' && project.created_by !== req.user.id) {
      return res.status(403).json({ error: "Not authorized to update this project" });
    }

    let updateQuery = `UPDATE projects SET name = ?, description = ?, budget = ?, start_date = ?, end_date = ?, status = ?, updated_at = CURRENT_TIMESTAMP`;
    let params = [name, description, budget, start_date, end_date, status];

    // Handle image update if provided
    if (req.file) {
      updateQuery += `, plan_image = ?, plan_image_type = ?`;
      params.push(req.file.buffer, req.file.mimetype);
    }

    updateQuery += ` WHERE id = ?`;
    params.push(req.params.id);

    await db.run(updateQuery, params);

    const updatedProject = await db.get("SELECT * FROM projects WHERE id = ?", req.params.id);
    
    // Convert BLOB to base64 for response
    if (updatedProject.plan_image) {
      updatedProject.plan_image_url = `data:${updatedProject.plan_image_type};base64,${updatedProject.plan_image.toString('base64')}`;
    }
    
    res.json(updatedProject);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete project
router.delete("/:id", authenticateToken, async (req, res) => {
  try {
    const db = await dbPromise;
    const project = await db.get("SELECT * FROM projects WHERE id = ?", req.params.id);
    
    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }
    
    if (req.user.user_type !== 'admin' && project.created_by !== req.user.id) {
      return res.status(403).json({ error: "Not authorized to delete this project" });
    }

    await db.run("DELETE FROM projects WHERE id = ?", req.params.id);
    res.json({ message: "Project deleted successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get available civil engineers
router.get("/available-engineers", authenticateToken, async (req, res) => {
  try {
    const db = await dbPromise;
    const engineers = await db.all(
      `SELECT id, username, email FROM users 
       WHERE user_type = 'worker' AND sub_user_type = 'civil_engineer' and is_available = 1`
    );
    res.json(engineers);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Send worker request
router.post("/:id/request-worker", authenticateToken, async (req, res) => {
  try {
    const { worker_id, message } = req.body;
    const db = await dbPromise;
    
    // Check if project exists and user owns it
    const project = await db.get("SELECT * FROM projects WHERE id = ?", req.params.id);
    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }
    
    if (project.created_by !== req.user.id) {
      return res.status(403).json({ error: "Not authorized" });
    }

    // Check if worker is available
    const worker = await db.get(
      "SELECT * FROM users WHERE id = ? AND user_type = 'worker' AND sub_user_type = 'civil_engineer' AND is_available = 1",
      worker_id
    );
    
    if (!worker) {
      return res.status(400).json({ error: "Worker not available" });
    }

    // Check if request already exists
    const existingRequest = await db.get(
      "SELECT * FROM worker_requests WHERE project_id = ? AND worker_id = ? AND status = 'pending'",
      req.params.id, worker_id
    );
    
    if (existingRequest) {
      return res.status(400).json({ error: "Request already sent to this worker" });
    }

    const result = await db.run(
      `INSERT INTO worker_requests (project_id, worker_id, requested_by, message)
       VALUES (?, ?, ?, ?)`,
      [req.params.id, worker_id, req.user.id, message]
    );

    res.status(201).json({ message: "Worker request sent successfully", id: result.lastID });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
