-- =========================================================
-- SPASIS minimum database schema for a fresh installation
-- Database: na_pp_db
--
-- IMPORTANT:
-- If you already have a working na_pp_db database, DO NOT
-- blindly replace your existing data with this file. Use it as
-- a reference or run only the missing CREATE TABLE statements.
-- =========================================================

CREATE DATABASE IF NOT EXISTS na_pp_db
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE na_pp_db;

CREATE TABLE IF NOT EXISTS divisions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    division_name VARCHAR(255) NOT NULL,
    UNIQUE KEY uq_division_name (division_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS districts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    district_name VARCHAR(255) NOT NULL,
    division_id INT NOT NULL,
    KEY idx_district_division (division_id),
    UNIQUE KEY uq_district_division (division_id, district_name),
    CONSTRAINT fk_district_division
        FOREIGN KEY (division_id) REFERENCES divisions(id)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS tehsils (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tehsil_name VARCHAR(255) NOT NULL,
    district_id INT NOT NULL,
    KEY idx_tehsil_district (district_id),
    UNIQUE KEY uq_tehsil_district (district_id, tehsil_name),
    CONSTRAINT fk_tehsil_district
        FOREIGN KEY (district_id) REFERENCES districts(id)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS areas (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tehsil_id INT NOT NULL,
    site_name VARCHAR(255) NULL,
    na VARCHAR(255) NULL,
    pp VARCHAR(255) NULL,
    boundary VARCHAR(255) NULL,
    plant_type VARCHAR(255) NULL,
    category VARCHAR(255) NULL,
    executing_agency VARCHAR(255) NULL,
    installation VARCHAR(255) NULL,
    lat DECIMAL(12,8) NULL,
    lng DECIMAL(12,8) NULL,
    KEY idx_area_tehsil (tehsil_id),
    KEY idx_area_site (site_name),
    KEY idx_area_na (na),
    KEY idx_area_pp (pp),
    CONSTRAINT fk_area_tehsil
        FOREIGN KEY (tehsil_id) REFERENCES tehsils(id)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS map_boundaries (
    id INT AUTO_INCREMENT PRIMARY KEY,
    boundary_type VARCHAR(50) NOT NULL,
    division_name VARCHAR(255) NULL,
    district_name VARCHAR(255) NULL,
    tehsil_name VARCHAR(255) NULL,
    na_name VARCHAR(255) NULL,
    pp_name VARCHAR(255) NULL,
    boundary_name VARCHAR(255) NULL,
    geometry LONGTEXT NOT NULL,
    KEY idx_boundary_type (boundary_type),
    KEY idx_boundary_division (division_name),
    KEY idx_boundary_district (district_name),
    KEY idx_boundary_tehsil (tehsil_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS progress_records (
    id INT AUTO_INCREMENT PRIMARY KEY,
    division VARCHAR(255) NOT NULL,
    district VARCHAR(255) NOT NULL,
    tehsil VARCHAR(255) NOT NULL,
    package_name VARCHAR(255) NOT NULL,
    site_name VARCHAR(255) NOT NULL,
    plant_type VARCHAR(255) NULL,
    lat DECIMAL(12,8) NOT NULL,
    lng DECIMAL(12,8) NOT NULL,
    accuracy DECIMAL(10,2) NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'In Progress',
    start_date DATE NULL,
    end_date DATE NULL,
    remarks TEXT NULL,
    captured_at VARCHAR(100) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_progress_division (division),
    KEY idx_progress_district (district),
    KEY idx_progress_tehsil (tehsil),
    KEY idx_progress_package (package_name),
    KEY idx_progress_site (site_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(100) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'user',
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_users_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
