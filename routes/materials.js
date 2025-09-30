import express from "express";
import dbPromise from "../db.js";
import { authenticateToken } from "../middleware/auth.js";

const router = express.Router();

// Get all materials
router.get("/", authenticateToken, async (req, res) => {
  try {
    const db = await dbPromise;
    const materials = await db.all(
      "SELECT * FROM materials ORDER BY category, name"
    );
    res.json(materials);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create material (admin only)
router.post("/", authenticateToken, async (req, res) => {
  if (req.user.user_type !== 'admin') {
    return res.status(403).json({ error: "Only admins can create materials" });
  }

  try {
    const { name, description, unit, price_per_unit, stock_quantity, category } = req.body;
    const db = await dbPromise;
    
    const result = await db.run(
      `INSERT INTO materials (name, description, unit, price_per_unit, stock_quantity, category)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [name, description, unit, price_per_unit, stock_quantity, category]
    );

    const material = await db.get("SELECT * FROM materials WHERE id = ?", result.lastID);
    res.status(201).json(material);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update material (admin only)
router.put("/:id", authenticateToken, async (req, res) => {
  if (req.user.user_type !== 'admin') {
    return res.status(403).json({ error: "Only admins can update materials" });
  }

  try {
    const { name, description, unit, price_per_unit, stock_quantity, category } = req.body;
    const db = await dbPromise;
    
    await db.run(
      `UPDATE materials SET name = ?, description = ?, unit = ?, price_per_unit = ?, 
       stock_quantity = ?, category = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [name, description, unit, price_per_unit, stock_quantity, category, req.params.id]
    );

    const material = await db.get("SELECT * FROM materials WHERE id = ?", req.params.id);
    res.json(material);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete material (admin only)
router.delete("/:id", authenticateToken, async (req, res) => {
  if (req.user.user_type !== 'admin') {
    return res.status(403).json({ error: "Only admins can delete materials" });
  }

  try {
    const db = await dbPromise;
    await db.run("DELETE FROM materials WHERE id = ?", req.params.id);
    res.json({ message: "Material deleted successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Order materials for project (civil engineer only)
router.post("/order", authenticateToken, async (req, res) => {
  // if (req.user.user_type !== 'worker' || req.user.sub_user_type !== 'civil_engineer') {
  //   return res.status(403).json({ error: "Only civil engineers can order materials" });
  // }

  try {
    const { project_id, material_id, quantity } = req.body;
    const db = await dbPromise;
    
    // Check if civil engineer is assigned to this project
    const project = await db.get(
      "SELECT * FROM projects WHERE id = ? AND civil_engineer_id = ?",
      project_id, req.user.id
    );
    
    if (!project) {
      return res.status(403).json({ error: "Not authorized for this project" });
    }

    // Get material details
    const material = await db.get("SELECT * FROM materials WHERE id = ?", material_id);
    if (!material) {
      return res.status(404).json({ error: "Material not found" });
    }

    if (material.stock_quantity < quantity) {
      return res.status(400).json({ error: "Insufficient stock" });
    }

    const total_cost = material.price_per_unit * quantity;

    await db.run("BEGIN TRANSACTION");

    try {
      // Add to project materials
      await db.run(
        `INSERT INTO project_materials (project_id, material_id, quantity, total_cost, ordered_by)
         VALUES (?, ?, ?, ?, ?)`,
        [project_id, material_id, quantity, total_cost, req.user.id]
      );
      
      // Update material stock
      await db.run(
        "UPDATE materials SET stock_quantity = stock_quantity - ? WHERE id = ?",
        [quantity, material_id]
      );

      await db.run("COMMIT");
      res.json({ message: "Material ordered successfully", total_cost });
    } catch (error) {
      await db.run("ROLLBACK");
      throw error;
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get project materials
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

    const materials = await db.all(
      `SELECT pm.*, m.name, m.description, m.unit, m.price_per_unit, u.username as ordered_by_name
       FROM project_materials pm
       JOIN materials m ON pm.material_id = m.id
       JOIN users u ON pm.ordered_by = u.id
       WHERE pm.project_id = ?
       ORDER BY pm.ordered_at DESC`,
      req.params.projectId
    );
    
    res.json(materials);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
