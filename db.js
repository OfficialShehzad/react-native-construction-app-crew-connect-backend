import sqlite3 from "sqlite3";
import { open } from "sqlite";
import bcrypt from "bcrypt";

// Open SQLite connection
const dbPromise = open({
  filename: "./construction-app.db",
  driver: sqlite3.Database,
});

// Initialize tables
async function initDB() {
  const db = await dbPromise;
  
  // Users table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      email TEXT UNIQUE,
      password TEXT,
      user_type TEXT CHECK(user_type IN ('admin', 'user', 'worker')),
      sub_user_type TEXT DEFAULT NULL CHECK(sub_user_type IN ('civil_engineer', 'painter', 'plumber', 'electrician', 'other')),
      is_available BOOLEAN DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Projects table - Updated to use BLOB for plan_image
  await db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      budget DECIMAL(10,2),
      plan_image BLOB,
      plan_image_type TEXT,
      status TEXT DEFAULT 'planning' CHECK(status IN ('planning', 'in_progress', 'completed', 'cancelled')),
      start_date DATE,
      end_date DATE,
      created_by INTEGER,
      civil_engineer_id INTEGER DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by) REFERENCES users(id),
      FOREIGN KEY (civil_engineer_id) REFERENCES users(id)
    );
  `);

  // Worker requests table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS worker_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER,
      worker_id INTEGER,
      requested_by INTEGER,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'accepted', 'rejected')),
      message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      responded_at DATETIME DEFAULT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id),
      FOREIGN KEY (worker_id) REFERENCES users(id),
      FOREIGN KEY (requested_by) REFERENCES users(id)
    );
  `);

  // Project workers table (for assigned workers)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS project_workers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER,
      worker_id INTEGER,
      assigned_by INTEGER,
      role TEXT,
      assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects(id),
      FOREIGN KEY (worker_id) REFERENCES users(id),
      FOREIGN KEY (assigned_by) REFERENCES users(id)
    );
  `);

  // Materials table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS materials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      unit TEXT NOT NULL,
      price_per_unit DECIMAL(10,2),
      stock_quantity INTEGER DEFAULT 0,
      category TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Project materials table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS project_materials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER,
      material_id INTEGER,
      quantity INTEGER,
      total_cost DECIMAL(10,2),
      ordered_by INTEGER,
      ordered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects(id),
      FOREIGN KEY (material_id) REFERENCES materials(id),
      FOREIGN KEY (ordered_by) REFERENCES users(id)
    );
  `);

  // Project milestones table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS project_milestones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER,
      title TEXT NOT NULL,
      description TEXT,
      target_date DATE,
      completion_date DATE DEFAULT NULL,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'in_progress', 'completed')),
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects(id),
      FOREIGN KEY (created_by) REFERENCES users(id)
    );
  `);

  // Insert default super_admin if not already there
  const hashedPassword = await bcrypt.hash("123456", 10);
  await db.run(
    `INSERT OR IGNORE INTO users (username, email, password, user_type)
     VALUES (?, ?, ?, ?)`, ['super_admin', 'admin@gmail.com', hashedPassword, 'admin']
  );

  // Insert some default materials
  await db.run(`INSERT OR IGNORE INTO materials (id, name, description, unit, price_per_unit, stock_quantity, category) VALUES 
    (1, 'Cement', 'Portland Cement 50kg bag', 'bag', 450.00, 100, 'Building Materials'),
    (2, 'Steel Rods', 'TMT Steel Rods 12mm', 'kg', 65.00, 500, 'Steel'),
    (3, 'Bricks', 'Red Clay Bricks', 'piece', 8.00, 1000, 'Building Materials'),
    (4, 'Sand', 'River Sand', 'cubic_meter', 1200.00, 50, 'Aggregates'),
    (5, 'Gravel', 'Construction Gravel', 'cubic_meter', 1500.00, 30, 'Aggregates')`);

  // Migrate existing plan_image_url to plan_image if needed
  try {
    await db.exec(`
      ALTER TABLE users ADD COLUMN is_available BOOLEAN DEFAULT 1;
    `);
  } catch (error) {
    // Column might already exist, ignore error
  }

}

initDB();

export default dbPromise;
