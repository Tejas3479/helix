# 🤝 Contributing to Helix Quantum

Thank you for your interest in contributing to **Helix Quantum**! We welcome contributions to improve our 3D WebGL visualizations, multi-agent AI playbooks, and cloud reliability telemetry.

---

## 🛠️ Local Development Setup

1. Fork and clone the repository:
   ```bash
   git clone https://github.com/Tejas3479/helix.git
   cd helix
   ```

2. Install dependencies:
   ```bash
   npm install
   pip install -r requirements.txt
   ```

3. Run syntax validation:
   ```bash
   # Validate Node.js gateway
   node --check server.js

   # Validate Python FastAPI backend
   python -m py_compile server.py
   ```

4. Launch the local dev server:
   ```bash
   npm run dev
   ```

---

## 📐 Coding Conventions

- **Frontend JavaScript (`app.js`, `space3d.js`):** Vanilla ES6+ without heavy frameworks. Ensure all DOM content injection uses `textContent` or `escapeHtml()` to prevent XSS vulnerabilities.
- **Styling (`styles.css`):** Vanilla CSS using CSS variables (`--accent-cyan`, `--glass-bg`, etc.). Avoid hardcoded pixel values for layout heights.
- **Backend API (`server.js`, `server.py`):** Maintain authorization gates (`authGate`) on all modifying POST endpoints.

---

## 📜 License
By contributing to Helix Quantum, you agree that your contributions will be licensed under the [ISC License](LICENSE).
