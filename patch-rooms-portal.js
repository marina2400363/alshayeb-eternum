const fs = require('fs');

const code = `
function RoomsAdminLogin() {
  const navigate = useNavigate();
  const [credentials, setCredentials] = useState({ email: "", password: "" });
  const [loginError, setLoginError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (isAdminAuthenticated()) {
    return <Navigate to="/rooms-control/dashboard" replace />;
  }

  const handleSubmit = async (event) => {
    event.preventDefault();
    setLoginError("");
    setIsSubmitting(true);
    try {
      const result = await apiRequest("/api/admin/auth/login", {
        method: "POST",
        body: JSON.stringify({
          email: String(credentials.email ?? "").trim(),
          password: credentials.password
        })
      });
      const EIGHT_HOURS_MS = 8 * 60 * 60 * 1000;
      localStorage.setItem(
        ADMIN_SESSION_KEY,
        JSON.stringify({
          authenticated: true,
          email: String(credentials.email ?? "").trim().toLowerCase(),
          token: result.token,
          expiresAt: Date.now() + EIGHT_HOURS_MS,
          signedInAt: new Date().toISOString()
        })
      );
      navigate("/rooms-control/dashboard", { replace: true });
    } catch (err) {
      setLoginError(err.message || "Invalid admin email or password.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="app-shell admin-page admin-bg tone-gold">
      <AnimatedBackground />
      <motion.form className="cosmic-card tone-card admin-login-card" {...pageMotion} onSubmit={handleSubmit}>
        <div className="ring small-ring"></div>
        <h3>ALSHAYEB</h3>
        <h1 className="brand-title">ROOMS CONTROL</h1>
        <p className="muted">ROOMS ADMIN ACCESS</p>
        <input className={loginError ? "error-input" : ""} type="email" placeholder="Admin email" value={credentials.email} onChange={(e) => { setCredentials(p => ({...p, email: e.target.value})); setLoginError(""); }} />
        <input className={loginError ? "error-input" : ""} type="password" placeholder="Password" value={credentials.password} onChange={(e) => { setCredentials(p => ({...p, password: e.target.value})); setLoginError(""); }} />
        {loginError && <p className="field-error center-error">{loginError}</p>}
        <button className="purple-btn" type="submit" disabled={isSubmitting}>
          {isSubmitting ? "AUTHENTICATING..." : "ENTER ROOMS CONTROL"}
        </button>
        <Link className="admin-link" to="/">
          BACK TO PUBLIC SITE
        </Link>
      </motion.form>
    </div>
  );
}

function RoomsAdminLayout({ children, view, setView }) {
  const navigate = useNavigate();
  const navItems = [
    { label: "Hotels", id: "hotels" },
    { label: "Room Types", id: "roomTypes" },
    { label: "Reservations", id: "reservations" }
  ];

  const handleLogout = () => {
    localStorage.removeItem(ADMIN_SESSION_KEY);
    navigate("/rooms-control", { replace: true });
  };

  return (
    <div className="admin-control-page admin-bg tone-gold">
      <AnimatedBackground />
      <motion.div className="admin-control-shell" {...pageMotion}>
        <aside className="admin-sidebar">
          <div>
            <span>ALSHAYEB</span>
            <h1>ROOMS</h1>
          </div>
          <nav>
            {navItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setView && setView(item.id)}
                className={view === item.id ? "active-admin-link" : "admin-sidebar-btn"}
              >
                {item.label}
              </button>
            ))}
            <Link to="/">Public Site</Link>
            <button className="admin-logout-btn" onClick={handleLogout}>
              Logout
            </button>
          </nav>
        </aside>
        <main className="admin-content-area">{children}</main>
      </motion.div>
    </div>
  );
}
`;

let appJs = fs.readFileSync('src/App.js', 'utf8');

if (!appJs.includes('function RoomsAdminLogin()')) {
  appJs = appJs.replace('// --- ROOMS ADMIN ---', code + '\n// --- ROOMS ADMIN ---');
}

fs.writeFileSync('src/App.js', appJs);
console.log('Patch successful.');
