import { Fragment, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import JsBarcode from "jsbarcode";
import { BrowserMultiFormatReader } from "@zxing/browser";
import type { User } from "@supabase/supabase-js";
import { supabase } from "./lib/supabase";
import boutiqueImage from "./assets/stockwise-boutique.png";
import "./App.StockWise.Grouped.css";
import "./App.StockWise.Stock.css";
import "./App.StockWise.Sales.css";
import "./App.StockWise.PhoneScan.css";

function BarcodeGraphic({ value }: { value: string }) {
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    if (!svgRef.current || !value) return;
    try {
      JsBarcode(svgRef.current, value, {
        format: "CODE128",
        displayValue: false,
        margin: 0,
        height: 42,
        width: 1.5,
        background: "#ffffff",
        lineColor: "#111827",
      });
    } catch {
      if (svgRef.current) svgRef.current.innerHTML = "";
    }
  }, [value]);

  return <svg ref={svgRef} className="stock-barcode-graphic" role="img" aria-label={`Code-barres ${value}`} />;
}

type Shop = {
  id: string;
  name: string;
  currency_code: string;
  timezone: string;
};


/** Connexion temporaire du téléphone au module actif du PC. */
function PhoneScanConnector({ shop, onBarcode, title }: { shop: Shop | null; onBarcode: (barcode: string) => Promise<void>; title: string }) {
  const [pairingCode, setPairingCode] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [connectorError, setConnectorError] = useState("");
  const [connected, setConnected] = useState(false);
  const handled = useRef<Set<string>>(new Set());
  const onBarcodeRef = useRef(onBarcode);
  onBarcodeRef.current = onBarcode;

  async function startSession() {
    if (!shop || busy) return;
    setBusy(true); setConnectorError(""); handled.current.clear();
    try {
      const { data, error } = await supabase.rpc("create_phone_scan_session", { p_shop_id: shop.id });
      if (error) throw new Error(error.message);
      const row = Array.isArray(data) ? data[0] : data;
      if (!row?.pairing_code) throw new Error("Supabase n’a pas retourné de code de connexion.");
      setPairingCode(String(row.pairing_code)); setExpiresAt(String(row.expires_at ?? "")); setConnected(true);
    } catch (e) { setConnectorError(e instanceof Error ? e.message : "Impossible de connecter le téléphone."); }
    finally { setBusy(false); }
  }

  async function closeSession() {
    if (shop && pairingCode) {
      try { await supabase.rpc("close_phone_scan_session", { p_shop_id: shop.id, p_pairing_code: pairingCode }); } catch { /* expiration serveur de secours */ }
    }
    setConnected(false); setPairingCode(""); setExpiresAt("");
  }

  useEffect(() => {
    if (!connected || !shop || !pairingCode) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const { data, error } = await supabase.rpc("read_phone_scans", { p_shop_id: shop.id, p_pairing_code: pairingCode });
        if (error) throw new Error(error.message);
        for (const event of (data ?? []) as Array<{ event_id: string; barcode: string }>) {
          if (cancelled || handled.current.has(event.event_id)) continue;
          handled.current.add(event.event_id);
          try {
            await onBarcodeRef.current(event.barcode);
            if (!cancelled) await supabase.rpc("ack_phone_scan", { p_shop_id: shop.id, p_pairing_code: pairingCode, p_event_id: event.event_id });
          } catch (e) {
            handled.current.delete(event.event_id);
            if (!cancelled) setConnectorError(e instanceof Error ? e.message : "Impossible de traiter ce code-barres.");
          }
        }
      } catch (e) {
        if (!cancelled) setConnectorError(e instanceof Error ? e.message : "La session mobile a expiré.");
      }
    };
    void poll();
    const timer = window.setInterval(() => { void poll(); }, 1800);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [connected, shop?.id, pairingCode]);

  return <section className="product-form-card phone-scan-connector">
    <div className="product-form-heading"><div><h2><Icon name="smartphone" size={19} /> Scanner avec un téléphone</h2><p>{title} · Les scans arrivent dans ce module et ne modifient pas le stock à eux seuls.</p></div></div>
    {!connected ? <button className="secondary-button" type="button" onClick={() => void startSession()} disabled={!shop || busy}><Icon name="smartphone" size={16} /> {busy ? "Préparation…" : "Connecter un téléphone"}</button> : <>
      <div className="phone-scan-code"><span>Code temporaire</span><strong>{pairingCode}</strong><small>Expire {expiresAt ? new Date(expiresAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "dans 10 minutes"}</small></div>
      <p className="phone-scan-instructions">Sur le téléphone, ouvre l’adresse de StockWise, ajoute <code>?phone-scan={pairingCode}</code> à l’URL si nécessaire, puis autorise la caméra. Garde cette page PC ouverte.</p>
      <div className="product-form-actions"><button className="secondary-button" type="button" onClick={() => void closeSession()}>Déconnecter le téléphone</button><button className="secondary-button" type="button" onClick={() => void startSession()}>Générer un autre code</button></div>
    </>}
    {connectorError && <p className="catalog-error" role="alert">{connectorError}</p>}
  </section>;
}

/** Page publique utilisée uniquement lorsque l’URL contient ?phone-scan=CODE. */
function PhoneScanPage() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);
  const [scanning, setScanning] = useState(false);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const pairingCode = new URLSearchParams(window.location.search).get("phone-scan")?.trim().toUpperCase() ?? "";
  useEffect(() => () => { try { controlsRef.current?.stop(); } catch { /* caméra déjà fermée */ } }, []);

  async function sendBarcode(value: string) {
    const barcode = value.trim();
    if (!barcode || !pairingCode || sending) return;
    setSending(true); setError(""); setMessage("");
    try {
      const { error: rpcError } = await supabase.rpc("submit_phone_scan", { p_pairing_code: pairingCode, p_barcode: barcode });
      if (rpcError) throw new Error(rpcError.message);
      setCode(""); setMessage(`Code ${barcode} transmis au PC.`);
    } catch (e) { setError(e instanceof Error ? e.message : "Le code n’a pas pu être transmis."); }
    finally { setSending(false); }
  }

  async function startCamera() {
    setError("");
    if (!pairingCode) { setError("Code de connexion absent. Génère un code depuis le PC."); return; }
    if (!navigator.mediaDevices?.getUserMedia) { setError("La caméra nécessite HTTPS et un navigateur compatible."); return; }
    try {
      const reader = new BrowserMultiFormatReader(); setScanning(true);
      const controls = await reader.decodeFromVideoDevice(undefined, videoRef.current!, (result) => {
        if (!result) return;
        const value = result.getText().trim(); if (!value || sending) return;
        try { controlsRef.current?.stop(); } catch { /* no-op */ }
        controlsRef.current = null; setScanning(false); void sendBarcode(value);
      });
      controlsRef.current = controls;
      if (!videoRef.current?.isConnected) { controls.stop(); controlsRef.current = null; setScanning(false); }
    } catch (e) { setScanning(false); setError(e instanceof Error ? e.message : "Impossible d’ouvrir la caméra."); }
  }
  function stopCamera() { try { controlsRef.current?.stop(); } catch { /* no-op */ } controlsRef.current = null; setScanning(false); }

  return <main className="phone-scan-page"><section className="product-form-card phone-scan-mobile-card"><Brand /><span className="section-eyebrow">CONNEXION TEMPORAIRE</span><h1>Scanner StockWise</h1><p>Scanne les codes-barres pour les transmettre au PC. Le scan seul ne modifie jamais le stock.</p>
    {!pairingCode && <p className="catalog-error">Code absent. Reviens sur le PC et utilise le lien avec le code temporaire.</p>}
    {error && <p className="catalog-error" role="alert">{error}</p>}{message && <div className="catalog-notice" role="status">{message}</div>}
    <div className="stock-scan-video-wrap"><video ref={videoRef} className="stock-scan-video" muted playsInline aria-label="Caméra mobile pour scanner les codes-barres" />{!scanning && <div className="stock-scan-placeholder"><Icon name="scan" size={36} /><span>Caméra arrêtée</span></div>}{scanning && <div className="stock-scan-frame" aria-hidden="true" />}</div>
    <div className="product-form-actions">{!scanning ? <button className="primary-button" type="button" onClick={() => void startCamera()} disabled={!pairingCode || sending}>Démarrer la caméra</button> : <button className="secondary-button" type="button" onClick={stopCamera}>Arrêter la caméra</button>}</div>
    <form onSubmit={(e) => { e.preventDefault(); void sendBarcode(code); }}><label htmlFor="phone-barcode">Ou saisir le code manuellement</label><input id="phone-barcode" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" required /><button className="primary-button" type="submit" disabled={!pairingCode || sending || !code.trim()}>{sending ? "Envoi…" : "Envoyer au PC"}</button></form>
  </section></main>;
}

function App() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [user, setUser] = useState<User | null>(null);
  const [shop, setShop] = useState<Shop | null>(null);
  const [loading, setLoading] = useState(true);
  const [shopLoading, setShopLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [shopError, setShopError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [activeModule, setActiveModule] = useState<"dashboard" | "products" | "stock" | "scanner" | "sales" | "receipts">(
    "dashboard",
  );
  const [dashboardMetrics, setDashboardMetrics] = useState({ productCount: 0, salesToday: 0, lowStockCount: 0, stockValue: 0, stockMovementCount: 0, salesCount: 0 });
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [dashboardError, setDashboardError] = useState("");

  useEffect(() => {
    let mounted = true;

    async function loadSession() {
      try {
        const { data, error: sessionError } = await supabase.auth.getSession();

        if (!mounted) return;

        if (sessionError) {
          setError("Impossible de vérifier la session. Réessaie.");
        } else {
          setUser(data.session?.user ?? null);
        }
      } catch {
        if (!mounted) return;
        setError("Impossible de contacter le service de connexion.");
      } finally {
        if (mounted) setLoading(false);
      }
    }

    void loadSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (mounted) {
        setUser(session?.user ?? null);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadShop() {
      if (!user) {
        setShop(null);
        setShopError("");
        setShopLoading(false);
        return;
      }

      setShop(null);
      setShopError("");
      setShopLoading(true);

      try {
        const { data, error: queryError } = await supabase
          .from("shops")
          .select("id, name, currency_code, timezone")
          .eq("owner_id", user.id)
          .maybeSingle();

        if (cancelled) return;

        if (queryError) {
          setShopError(
            "Impossible de charger la boutique. Vérifie les autorisations Supabase.",
          );
          return;
        }

        if (!data) {
          setShopError(
            "Aucune boutique associée à ce compte. Vérifie le propriétaire dans Supabase.",
          );
          return;
        }

        setShop(data as Shop);
      } catch {
        if (!cancelled) {
          setShopError(
            "Une erreur est survenue lors du chargement de la boutique.",
          );
        }
      } finally {
        if (!cancelled) setShopLoading(false);
      }
    }

    void loadShop();

    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    let cancelled = false;
    function dateParts(date: Date, timeZone: string) {
      const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
      const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
      return { year: Number(values.year), month: Number(values.month), day: Number(values.day) };
    }
    function zonedMidnightToUtc(year: number, month: number, day: number, timeZone: string) {
      const target = Date.UTC(year, month - 1, day);
      let guess = target;
      for (let i = 0; i < 3; i += 1) {
        const parts = new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(guess));
        const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
        const represented = Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day), Number(values.hour), Number(values.minute), Number(values.second));
        guess += target - represented;
      }
      return new Date(guess).toISOString();
    }
    async function loadMetrics() {
      if (!shop?.id) {
        setDashboardMetrics({ productCount: 0, salesToday: 0, lowStockCount: 0, stockValue: 0, stockMovementCount: 0, salesCount: 0 });
        setDashboardLoading(false); setDashboardError(""); return;
      }
      setDashboardLoading(true); setDashboardError("");
      try {
        const zone = shop.timezone || "Africa/Lubumbashi";
        const parts = dateParts(new Date(), zone);
        const start = zonedMidnightToUtc(parts.year, parts.month, parts.day, zone);
        const tomorrow = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + 1));
        const end = zonedMidnightToUtc(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth() + 1, tomorrow.getUTCDate(), zone);
        const [productsResult, variantsResult, salesResult, allSalesResult, stockMovementsResult] = await Promise.all([
          supabase.from("products").select("id", { count: "exact", head: true }).eq("shop_id", shop.id).eq("is_active", true),
          supabase.from("product_variants").select("stock_quantity, low_stock_threshold, purchase_price").eq("shop_id", shop.id).eq("is_active", true),
          supabase.from("sales").select("total_amount").eq("shop_id", shop.id).gte("created_at", start).lt("created_at", end),
          supabase.from("sales").select("id", { count: "exact", head: true }).eq("shop_id", shop.id),
          supabase.from("stock_movements").select("id", { count: "exact", head: true }).eq("shop_id", shop.id),
        ]);
        if (productsResult.error) throw new Error(`Produits : ${productsResult.error.message}`);
        if (variantsResult.error) throw new Error(`Stock : ${variantsResult.error.message}`);
        if (salesResult.error) throw new Error(`Ventes : ${salesResult.error.message}`);
        if (allSalesResult.error) throw new Error(`Historique des ventes : ${allSalesResult.error.message}`);
        if (stockMovementsResult.error) throw new Error(`Mouvements de stock : ${stockMovementsResult.error.message}`);
        if (cancelled) return;
        const variants = variantsResult.data ?? [];
        setDashboardMetrics({
          productCount: productsResult.count ?? 0,
          salesToday: (salesResult.data ?? []).reduce((sum, sale) => sum + Number(sale.total_amount ?? 0), 0),
          lowStockCount: variants.filter((v) => Number(v.stock_quantity ?? 0) <= Number(v.low_stock_threshold ?? 0)).length,
          stockValue: variants.reduce((sum, v) => sum + Number(v.stock_quantity ?? 0) * Number(v.purchase_price ?? 0), 0),
          stockMovementCount: stockMovementsResult.count ?? 0,
          salesCount: allSalesResult.count ?? 0,
        });
      } catch (err) {
        if (!cancelled) setDashboardError(err instanceof Error ? err.message : "Impossible de charger les indicateurs.");
      } finally { if (!cancelled) setDashboardLoading(false); }
    }
    void loadMetrics();
    const timer = window.setInterval(() => { void loadMetrics(); }, 5 * 60 * 1000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [shop?.id, shop?.timezone]);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      const { data, error: loginError } =
        await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });

      if (loginError) {
        setError(
          "Connexion impossible. Vérifie ton adresse e-mail et ton mot de passe.",
        );
        return;
      }

      setUser(data.user);
      setPassword("");
    } catch {
      setError(
        "Le serveur est inaccessible. Vérifie ta connexion Internet et réessaie.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleLogout() {
    setError("");
    setSubmitting(true);

    try {
      const { error: logoutError } = await supabase.auth.signOut();

      if (logoutError) {
        setError("Impossible de fermer la session. Réessaie.");
      } else {
        setShop(null);
        setShopError("");
      }
    } catch {
      setError("Une erreur est survenue lors de la déconnexion.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRetryShop() {
    if (!user) return;

    setShopError("");
    setShopLoading(true);

    try {
      const { data, error: queryError } = await supabase
        .from("shops")
        .select("id, name, currency_code, timezone")
        .eq("owner_id", user.id)
        .maybeSingle();

      if (queryError) {
        setShopError("Impossible de charger la boutique. Réessaie.");
        return;
      }

      if (!data) {
        setShopError("Aucune boutique associée à ce compte.");
        return;
      }

      setShop(data as Shop);
    } catch {
      setShopError("Erreur de connexion. Réessaie.");
    } finally {
      setShopLoading(false);
    }
  }

  if (new URLSearchParams(window.location.search).has("phone-scan")) return <PhoneScanPage />;

  if (loading) {
    return (
      <main className="auth-page auth-page-loading">
        <div className="loading-card" role="status">
          <span className="brand-mark">S</span>
          <p>Préparation de StockWise...</p>
        </div>
      </main>
    );
  }

  if (user) {
    const navItems = [
      {
        label: "Vue d'ensemble",
        icon: "dashboard" as const,
        active: activeModule === "dashboard",
        module: "dashboard" as const,
      },
      {
        label: "Produits",
        icon: "products" as const,
        active: activeModule === "products",
        module: "products" as const,
      },
      {
        label: "Gestion du stock",
        icon: "stock" as const,
        active: activeModule === "stock",
        module: "stock" as const,
      },
      { label: "Scanner", icon: "scanner" as const, active: activeModule === "scanner", module: "scanner" as const },
      { label: "Ventes", icon: "sales" as const, active: activeModule === "sales", module: "sales" as const },
      { label: "Reçus", icon: "receipts" as const, active: activeModule === "receipts", module: "receipts" as const },
    ];

    return (
      <main className="workspace">
        <aside className="workspace-sidebar">
          <div className="sidebar-brand">
            <Brand />
            <span className="sidebar-plan">INVENTAIRE</span>
          </div>

          <div className="sidebar-section-label">ESPACE DE TRAVAIL</div>
          <nav className="sidebar-nav" aria-label="Navigation principale">
            {navItems.map((item) => (
              <button
                key={item.label}
                className={`nav-item${item.active ? " nav-item-active" : ""}`}
                type="button"
                onClick={() => {
                  if ("module" in item && item.module) {
                    setActiveModule(item.module);
                  }
                }}
                aria-current={item.active ? "page" : undefined}
              >
                <Icon name={item.icon} />
                <span>{item.label}</span>
                {!("module" in item) && (
                  <span className="nav-coming-soon">Bientôt</span>
                )}
              </button>
            ))}
          </nav>

          <div className="sidebar-bottom">
            <div className="sidebar-help-icon">
              <Icon name="shield" size={18} />
            </div>
            <div className="sidebar-help-copy">
              <strong>Vos données sont protégées</strong>
              <span>Connexion sécurisée</span>
            </div>
          </div>
        </aside>

        <div className="workspace-main">
          <header className="workspace-topbar">
            <div className="breadcrumb">
              <span>Espace de travail</span>
              <Icon name="chevron-right" size={15} />
              <strong>
                {activeModule === "products" ? "Produits" : activeModule === "stock" ? "Gestion du stock" : activeModule === "scanner" ? "Scanner" : activeModule === "sales" ? "Ventes" : activeModule === "receipts" ? "Reçus" : "Vue d'ensemble"}
              </strong>
            </div>

            <div className="topbar-actions">
              <div className="topbar-shop">
                <span className="topbar-shop-mark">
                  <Icon name="store" size={17} />
                </span>
                <div>
                  <strong>{shop?.name ?? "Ma boutique"}</strong>
                  <span>{shop?.currency_code ?? "CDF"} · Goma, RDC</span>
                </div>
              </div>
              <div
                className="topbar-avatar"
                aria-label={`Compte ${user.email ?? ""}`}
              >
                {(user.email?.[0] ?? "U").toUpperCase()}
              </div>
              <button
                className="topbar-logout"
                type="button"
                onClick={handleLogout}
                disabled={submitting}
              >
                <Icon name="logout" size={17} />
                <span>{submitting ? "Déconnexion..." : "Déconnexion"}</span>
              </button>
            </div>
          </header>

          <div className="workspace-content">
            {activeModule === "products" ? (
              <ProductsModule shop={shop} />
            ) : activeModule === "stock" ? (
              <StockModule shop={shop} user={user} />
            ) : activeModule === "scanner" ? (
              <ScannerModule shop={shop} />
            ) : activeModule === "sales" ? (
              <SalesModule shop={shop} />
            ) : activeModule === "receipts" ? (
              <ReceiptsModule shop={shop} />
            ) : (
              <>
                <section className="dashboard-welcome">
                  <div>
                    <div className="welcome-overline">
                      <span className="live-dot" />
                      VOTRE ESPACE DE GESTION
                    </div>
                    <h1>Bonjour et bienvenue 👋</h1>
                    <p>
                      Gérez votre boutique en toute simplicité. Voici votre
                      espace de travail StockWise.
                    </p>
                  </div>
                  <div className="welcome-date">
                    <Icon name="calendar" size={17} />
                    <span>
                      {new Intl.DateTimeFormat("fr-FR", {
                        weekday: "long",
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                        timeZone: shop?.timezone || "Africa/Lubumbashi",
                      }).format(new Date())}
                    </span>
                  </div>
                </section>

                {shopLoading ? (
                  <div className="shop-feedback" role="status">
                    <span className="loading-spinner" aria-hidden="true" />
                    <div>
                      <strong>Chargement de votre boutique</strong>
                      <p>Nous récupérons les informations depuis Supabase.</p>
                    </div>
                  </div>
                ) : shopError ? (
                  <div
                    className="shop-feedback shop-feedback-error"
                    role="alert"
                  >
                    <span className="feedback-icon">
                      <Icon name="alert" size={20} />
                    </span>
                    <div className="feedback-copy">
                      <strong>Votre boutique n'est pas disponible</strong>
                      <p>{shopError}</p>
                      <button
                        className="secondary-button"
                        type="button"
                        onClick={handleRetryShop}
                      >
                        Réessayer
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <section className="shop-banner">
                      <div className="shop-banner-main">
                        <div className="shop-banner-icon">
                          <Icon name="store" size={24} />
                        </div>
                        <div className="shop-banner-copy">
                          <span className="shop-banner-label">
                            BOUTIQUE ACTIVE
                          </span>
                          <h2>{shop?.name ?? "StockWise Boutique"}</h2>
                          <p>
                            Votre espace est connecté et prêt à être configuré.
                          </p>
                        </div>
                      </div>
                      <div className="shop-banner-meta">
                        <div className="meta-pill">
                          <span className="meta-pill-icon">
                            <Icon name="wallet" size={16} />
                          </span>
                          <span>
                            <small>Devise</small>
                            <strong>{shop?.currency_code ?? "CDF"}</strong>
                          </span>
                        </div>
                        <div className="meta-pill">
                          <span className="meta-pill-icon">
                            <Icon name="clock" size={16} />
                          </span>
                          <span>
                            <small>Fuseau horaire</small>
                            <strong>
                              {shop?.timezone ?? "Africa/Lubumbashi"}
                            </strong>
                          </span>
                        </div>
                      </div>
                    </section>

                    <section
                      className="metrics-grid"
                      aria-label="Indicateurs de la boutique"
                    >
                      <article className="metric-card">
                        <div className="metric-topline"><span className="metric-icon metric-icon-green"><Icon name="products" size={20} /></span><span className="metric-placeholder">{dashboardLoading ? "Chargement…" : dashboardError ? "Indisponible" : "En direct"}</span></div>
                        <p>Produits enregistrés</p>
                        <div className="metric-value">{dashboardLoading ? "…" : dashboardMetrics.productCount}</div>
                        <span className="metric-footnote">Produits actifs du catalogue</span>
                      </article>
                      <article className="metric-card">
                        <div className="metric-topline"><span className="metric-icon metric-icon-blue"><Icon name="sales" size={20} /></span><span className="metric-placeholder">{dashboardLoading ? "Chargement…" : dashboardError ? "Indisponible" : "Aujourd’hui"}</span></div>
                        <p>Ventes du jour</p>
                        <div className="metric-value">{dashboardLoading ? "…" : formatMoney(dashboardMetrics.salesToday, shop?.currency_code ?? "CDF")}</div>
                        <span className="metric-footnote">Total des ventes enregistrées aujourd’hui</span>
                      </article>
                      <article className="metric-card">
                        <div className="metric-topline"><span className="metric-icon metric-icon-amber"><Icon name="stock" size={20} /></span><span className="metric-placeholder">{dashboardLoading ? "Chargement…" : dashboardError ? "Indisponible" : "En direct"}</span></div>
                        <p>Alertes de stock bas</p>
                        <div className="metric-value">{dashboardLoading ? "…" : dashboardMetrics.lowStockCount}</div>
                        <span className="metric-footnote">Variantes au seuil d’alerte ou en dessous</span>
                      </article>
                      <article className="metric-card">
                        <div className="metric-topline"><span className="metric-icon metric-icon-purple"><Icon name="wallet" size={20} /></span><span className="metric-placeholder">{dashboardLoading ? "Chargement…" : dashboardError ? "Indisponible" : "En direct"}</span></div>
                        <p>Valeur du stock</p>
                        <div className="metric-value">{dashboardLoading ? "…" : formatMoney(dashboardMetrics.stockValue, shop?.currency_code ?? "CDF")}</div>
                        <span className="metric-footnote">Valeur estimée au prix d’achat</span>
                      </article>
                    </section>
                    {dashboardError && <p className="catalog-error" role="alert">Les indicateurs n’ont pas pu être chargés : {dashboardError}</p>}

                    <section className="dashboard-lower-grid">
                      <article className="setup-card">
                        <div className="section-heading">
                          <div>
                            <span className="section-eyebrow">
                              POUR BIEN COMMENCER
                            </span>
                            <h2>Préparez votre boutique</h2>
                            <p>Quelques étapes pour démarrer avec StockWise.</p>
                          </div>
                          <span className="setup-progress">{Number(dashboardMetrics.productCount > 0) + Number(dashboardMetrics.stockMovementCount > 0) + Number(dashboardMetrics.salesCount > 0)} sur 3</span>
                        </div>

                        <div className="setup-steps">
                          <div className={`setup-step${dashboardMetrics.productCount > 0 ? " setup-step-complete" : ""}`}>
                            <span className="step-number">{dashboardMetrics.productCount > 0 ? "✓" : "1"}</span>
                            <div className="step-copy">
                              <strong>Créer votre catalogue</strong>
                              <span>
                                Ajoutez vos articles, leurs prix, tailles et
                                couleurs.
                              </span>
                            </div>
                            <span className="step-state">{dashboardLoading ? "Vérification…" : dashboardMetrics.productCount > 0 ? "Terminé" : "À faire"}</span>
                          </div>
                          <div className={`setup-step${dashboardMetrics.stockMovementCount > 0 ? " setup-step-complete" : ""}`}>
                            <span className="step-number">{dashboardMetrics.stockMovementCount > 0 ? "✓" : "2"}</span>
                            <div className="step-copy">
                              <strong>Organiser le stock</strong>
                              <span>
                                Enregistrez les quantités disponibles en
                                boutique.
                              </span>
                            </div>
                            <span className="step-state">{dashboardLoading ? "Vérification…" : dashboardMetrics.stockMovementCount > 0 ? "Terminé" : "À faire"}</span>
                          </div>
                          <div className={`setup-step${dashboardMetrics.salesCount > 0 ? " setup-step-complete" : ""}`}>
                            <span className="step-number">{dashboardMetrics.salesCount > 0 ? "✓" : "3"}</span>
                            <div className="step-copy">
                              <strong>Enregistrer vos premières ventes</strong>
                              <span>
                                Enregistrez une vente pour valider cette étape.
                              </span>
                            </div>
                            <span className="step-state">{dashboardLoading ? "Vérification…" : dashboardMetrics.salesCount > 0 ? "Terminé" : "À faire"}</span>
                          </div>
                        </div>
                      </article>

                      <article className="quickstart-card">
                        <div className="quickstart-art">
                          <div className="quickstart-art-circle quickstart-art-circle-one" />
                          <div className="quickstart-art-circle quickstart-art-circle-two" />
                          <div className="quickstart-art-icon">
                            <Icon name="scan" size={31} />
                          </div>
                          <span className="quickstart-art-tag">SCAN</span>
                        </div>
                        <span className="section-eyebrow">
                          FONCTIONNALITÉ DISPONIBLE
                        </span>
                        <h2>Le stock, en un scan.</h2>
                        <p>
                          Connectez votre téléphone pour scanner les codes-barres et transmettre les résultats à StockWise. La réception et les ventes restent contrôlées depuis votre ordinateur.
                        </p>
                        <button className="secondary-button" type="button" onClick={() => setActiveModule("scanner")}>
                          <Icon name="smartphone" size={16} /> Ouvrir le scanner
                        </button>
                        <div className="quickstart-note">
                          <Icon name="shield" size={17} />
                          <span>Le scan seul ne modifie pas le stock.</span>
                        </div>
                      </article>
                    </section>

                    <footer className="workspace-footer">
                      <span>© {new Date().getFullYear()} StockWise</span>
                      <span>
                        <Icon name="shield" size={14} /> Données protégées ·{" "}
                        {user.email}
                      </span>
                    </footer>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="auth-page">
      <section className="auth-shell">
        <aside className="auth-visual">
          <img
            className="auth-image"
            src={boutiqueImage}
            alt="Boutique de vêtements avec des articles prêts à être scannés"
          />

          <div className="visual-overlay" />

          <div className="visual-top">
            <Brand light />
            <span className="visual-tag">GESTION INTELLIGENTE</span>
          </div>

          <div className="visual-content">
            <p className="visual-eyebrow">VOTRE BOUTIQUE, MAÎTRISÉE</p>
            <h2>
              Chaque article
              <br />à sa place.
            </h2>
            <p>
              Gérez votre stock, suivez vos ventes et gardez le contrôle de
              votre boutique avec StockWise.
            </p>

            <div className="visual-features">
              <span>
                <span aria-hidden="true">✓</span> Stock en temps réel
              </span>
              <span>
                <span aria-hidden="true">✓</span> Scanner avec votre téléphone
              </span>
              <span>
                <span aria-hidden="true">✓</span> Ventes et reçus simplifiés
              </span>
            </div>
          </div>

          <p className="visual-footer">
            Simple à utiliser. Pensé pour votre commerce.
          </p>
        </aside>

        <section className="auth-panel">
          <div className="mobile-brand">
            <Brand />
          </div>

          <div className="form-container">
            <div className="login-heading">
              <p className="eyebrow">ESPACE VENDEUR</p>
              <h1>Bienvenue sur StockWise</h1>
              <p>
                Connecte-toi pour retrouver tes produits, gérer ton stock et
                enregistrer tes ventes.
              </p>
            </div>

            <form onSubmit={handleLogin} className="login-form">
              <div className="field-group">
                <label htmlFor="email">Adresse e-mail</label>
                <input
                  id="email"
                  type="email"
                  autoComplete="username"
                  placeholder="nom@exemple.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  disabled={submitting}
                />
              </div>

              <div className="field-group">
                <div className="password-label-row">
                  <label htmlFor="password">Mot de passe</label>
                  <button
                    className="text-button"
                    type="button"
                    onClick={() => setShowPassword((visible) => !visible)}
                  >
                    {showPassword ? "Masquer" : "Afficher"}
                  </button>
                </div>

                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="Saisis ton mot de passe"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  disabled={submitting}
                />
              </div>

              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}

              <button
                className="primary-button"
                type="submit"
                disabled={submitting}
              >
                {submitting ? "Connexion en cours..." : "Se connecter"}
                {!submitting && <span aria-hidden="true">→</span>}
              </button>
            </form>

            <div className="security-note">
              <span className="security-icon" aria-hidden="true">
                ✓
              </span>
              <p>Connexion sécurisée par Supabase.</p>
            </div>
          </div>

          <footer className="panel-footer">
            <span>© {new Date().getFullYear()} StockWise</span>
            <span>Gestion de stock simplifiée</span>
          </footer>
        </section>
      </section>
    </main>
  );
}

type ProductRow = {
  id: string;
  name: string;
  brand: string | null;
  description?: string | null;
  image_url?: string | null;
  category_id: string | null;
  is_active: boolean;
  product_variants?: {
    id: string;
    sku: string;
    barcode: string | null;
    size: string | null;
    color: string | null;
    purchase_price: number;
    selling_price: number;
    stock_quantity: number;
    low_stock_threshold: number;
    is_active: boolean;
  }[];
};

type CategoryRow = { id: string; name: string };

type ProductCategoryKind = "clothing" | "shoes" | "general";

function getProductCategoryKind(categoryName: string | undefined | null): ProductCategoryKind {
  const normalized = (categoryName ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("fr")
    .replace(/[’']/g, " ");

  if (/chauss|sneaker|basket|soulier|botte|sandale|escarpin/.test(normalized)) return "shoes";
  if (/vetement|t shirt|t-shirt|tshirt|chemise|pantalon|robe|jupe|pull|veste|jean|textile|lingerie|mode/.test(normalized)) return "clothing";
  return "general";
}

type ProductImageUpload = { url: string; path: string };

const PRODUCT_IMAGE_BUCKET = "stockwise-product-images";
const MAX_PRODUCT_IMAGE_BYTES = 5 * 1024 * 1024;

async function uploadProductImage(
  shopId: string,
  productId: string,
  file: File,
): Promise<ProductImageUpload> {
  const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
  if (!allowedTypes.includes(file.type)) {
    throw new Error("Choisis une image JPG, PNG ou WebP.");
  }
  if (file.size > MAX_PRODUCT_IMAGE_BYTES) {
    throw new Error("L’image ne doit pas dépasser 5 Mo.");
  }

  const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `${shopId}/${productId}/${crypto.randomUUID()}.${extension}`;
  const { error: uploadError } = await supabase.storage
    .from(PRODUCT_IMAGE_BUCKET)
    .upload(path, file, {
      cacheControl: "3600",
      contentType: file.type,
      upsert: false,
    });
  if (uploadError) throw new Error(`Impossible d’enregistrer la photo : ${uploadError.message}`);

  const { data } = supabase.storage.from(PRODUCT_IMAGE_BUCKET).getPublicUrl(path);
  if (!data.publicUrl) throw new Error("La photo a été téléversée, mais son URL est indisponible.");
  return { url: data.publicUrl, path };
}

function ProductsModule({ shop }: { shop: Shop | null }) {
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [showCategoryManager, setShowCategoryManager] = useState(false);
  const [categoryName, setCategoryName] = useState("");
  const [categorySaving, setCategorySaving] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [editingProduct, setEditingProduct] = useState<ProductRow | null>(null);
  const [editCategoryId, setEditCategoryId] = useState("");
  const [editingProductDetails, setEditingProductDetails] = useState<ProductRow | null>(null);
  const [editProductName, setEditProductName] = useState("");
  const [editProductBrand, setEditProductBrand] = useState("");
  const [editProductDescription, setEditProductDescription] = useState("");
  const [editProductImage, setEditProductImage] = useState<File | null>(null);
  const [editProductImagePreview, setEditProductImagePreview] = useState("");
  const [removeEditProductImage, setRemoveEditProductImage] = useState(false);
  const [editProductCategoryId, setEditProductCategoryId] = useState("");
  const [updatingProduct, setUpdatingProduct] = useState(false);
  const [search, setSearch] = useState("");
  const [feedback, setFeedback] = useState("");
  const [formError, setFormError] = useState("");
  const [name, setName] = useState("");
  const [brand, setBrand] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [description, setDescription] = useState("");
  const [productImage, setProductImage] = useState<File | null>(null);
  const [productImagePreview, setProductImagePreview] = useState("");
  const [size, setSize] = useState("");
  const [color, setColor] = useState("");
  const [barcode, setBarcode] = useState("");
  const [purchasePrice, setPurchasePrice] = useState("");
  const [sellingPrice, setSellingPrice] = useState("");
  const [lowStockThreshold, setLowStockThreshold] = useState("5");
  const [addingVariantTo, setAddingVariantTo] = useState<ProductRow | null>(null);
  const [variantSize, setVariantSize] = useState("");
  const [variantColor, setVariantColor] = useState("");
  const [variantBarcode, setVariantBarcode] = useState("");
  const [variantPurchasePrice, setVariantPurchasePrice] = useState("");
  const [variantSellingPrice, setVariantSellingPrice] = useState("");
  const [variantThreshold, setVariantThreshold] = useState("5");
  const [variantSaving, setVariantSaving] = useState(false);
  const [editingVariant, setEditingVariant] = useState<{
    product: ProductRow;
    variant: NonNullable<ProductRow["product_variants"]>[number];
  } | null>(null);
  const [editVariantSize, setEditVariantSize] = useState("");
  const [editVariantColor, setEditVariantColor] = useState("");
  const [editVariantBarcode, setEditVariantBarcode] = useState("");
  const [editVariantPurchasePrice, setEditVariantPurchasePrice] = useState("");
  const [editVariantSellingPrice, setEditVariantSellingPrice] = useState("");
  const [editVariantThreshold, setEditVariantThreshold] = useState("5");
  const [updatingVariant, setUpdatingVariant] = useState(false);
  const [expandedProducts, setExpandedProducts] = useState<string[]>([]);
  const [showArchivedProducts, setShowArchivedProducts] = useState(false);
  const [productActionId, setProductActionId] = useState<string | null>(null);

  const selectedCategoryKind = getProductCategoryKind(categories.find((category) => category.id === categoryId)?.name);
  const addedVariantCategoryKind = getProductCategoryKind(categories.find((category) => category.id === addingVariantTo?.category_id)?.name);
  const editedVariantCategoryKind = getProductCategoryKind(categories.find((category) => category.id === editingVariant?.product.category_id)?.name);
  const initialVariantDimensionLabel = selectedCategoryKind === "shoes" ? "Pointure" : "Taille";
  const addedVariantDimensionLabel = addedVariantCategoryKind === "shoes" ? "Pointure" : "Taille";
  const editedVariantDimensionLabel = editedVariantCategoryKind === "shoes" ? "Pointure" : "Taille";

  async function loadCatalog() {
    if (!shop) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setFormError("");
    const [productResult, categoryResult] = await Promise.all([
      supabase
        .from("products")
        .select(
          "id, name, brand, description, image_url, category_id, is_active, product_variants(id, sku, barcode, size, color, purchase_price, selling_price, stock_quantity, low_stock_threshold, is_active)",
        )
        .eq("shop_id", shop.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("categories")
        .select("id, name")
        .eq("shop_id", shop.id)
        .order("name"),
    ]);
    if (productResult.error)
      setFormError(
        `Impossible de charger les produits : ${productResult.error.message}`,
      );
    else setProducts((productResult.data ?? []) as ProductRow[]);
    if (categoryResult.error)
      setFormError(
        (previous) =>
          previous ||
          `Impossible de charger les catégories : ${categoryResult.error.message}`,
      );
    else setCategories((categoryResult.data ?? []) as CategoryRow[]);
    setLoading(false);
  }

  useEffect(() => {
    void loadCatalog();
  }, [shop?.id]);

  async function handleCreateCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!shop) { setFormError("La boutique n’est pas disponible."); return; }
    const cleanName = categoryName.trim();
    if (!cleanName) return;
    if (categories.some((category) => category.name.toLocaleLowerCase() === cleanName.toLocaleLowerCase())) {
      setFormError("Cette catégorie existe déjà.");
      return;
    }
    setCategorySaving(true);
    setFormError("");
    setFeedback("");
    try {
      const { data, error } = await supabase.from("categories")
        .insert({ shop_id: shop.id, name: cleanName })
        .select("id, name")
        .single();
      if (error || !data) throw new Error(error?.message || "La catégorie n’a pas pu être créée.");
      setCategories((previous) => [...previous, data as CategoryRow].sort((a, b) => a.name.localeCompare(b.name, "fr")));
      setCategoryName("");
      setFeedback(`Catégorie « ${cleanName} » créée avec succès.`);
    } catch (categoryError) {
      setFormError(categoryError instanceof Error ? categoryError.message : "Impossible de créer la catégorie.");
    } finally { setCategorySaving(false); }
  }

  async function handleDeleteCategory(category: CategoryRow) {
    if (!shop) return;
    const isUsed = products.some((product) => product.category_id === category.id);
    if (isUsed) { setFormError(`Impossible de supprimer « ${category.name} » : elle est utilisée par au moins un produit.`); return; }
    if (!window.confirm(`Supprimer la catégorie « ${category.name} » ?`)) return;
    setFormError("");
    try {
      const { error } = await supabase.from("categories").delete().eq("id", category.id).eq("shop_id", shop.id);
      if (error) throw new Error(error.message);
      setCategories((previous) => previous.filter((item) => item.id !== category.id));
      if (categoryFilter === category.id) setCategoryFilter("all");
      setFeedback(`Catégorie « ${category.name} » supprimée.`);
    } catch (categoryError) {
      setFormError(categoryError instanceof Error ? categoryError.message : "Impossible de supprimer la catégorie.");
    }
  }

  function startEditingProductDetails(product: ProductRow) {
    setEditingProductDetails(product);
    setEditProductName(product.name);
    setEditProductBrand(product.brand ?? "");
    setEditProductDescription(product.description ?? "");
    setEditProductImage(null);
    setEditProductImagePreview(product.image_url ?? "");
    setRemoveEditProductImage(false);
    setEditProductCategoryId(product.category_id ?? "");
    setFormError("");
    setFeedback("");
    setEditingProduct(null);
    setAddingVariantTo(null);
    setEditingVariant(null);
  }

  function cancelEditingProductDetails() {
    setEditingProductDetails(null);
    setEditProductName("");
    setEditProductBrand("");
    setEditProductDescription("");
    setEditProductImage(null);
    setEditProductImagePreview("");
    setRemoveEditProductImage(false);
    setEditProductCategoryId("");
    setFormError("");
  }

  async function handleUpdateProductDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!shop || !editingProductDetails) {
      setFormError("Sélectionne un produit à modifier.");
      return;
    }
    const cleanName = editProductName.trim();
    if (!cleanName) {
      setFormError("Le nom du produit est obligatoire.");
      return;
    }
    setUpdatingProduct(true);
    setFormError("");
    setFeedback("");
    try {
      let imageUrl = removeEditProductImage ? null : (editingProductDetails.image_url ?? null);
      if (editProductImage) {
        const uploaded = await uploadProductImage(shop.id, editingProductDetails.id, editProductImage);
        imageUrl = uploaded.url;
      }
      const { error } = await supabase
        .from("products")
        .update({
          name: cleanName,
          brand: editProductBrand.trim() || null,
          description: editProductDescription.trim() || null,
          category_id: editProductCategoryId || null,
          image_url: imageUrl,
        })
        .eq("id", editingProductDetails.id)
        .eq("shop_id", shop.id);
      if (error) throw new Error(error.message);
      const productId = editingProductDetails.id;
      setProducts((previous) => previous.map((product) => product.id === productId
        ? { ...product, name: cleanName, brand: editProductBrand.trim() || null, description: editProductDescription.trim() || null, category_id: editProductCategoryId || null, image_url: imageUrl }
        : product));
      setFeedback(`Les informations du produit « ${cleanName} » ont été mises à jour. Les références et le stock sont inchangés.`);
      cancelEditingProductDetails();
      await loadCatalog();
    } catch (updateError) {
      setFormError(updateError instanceof Error ? updateError.message : "Impossible de modifier le produit.");
    } finally {
      setUpdatingProduct(false);
    }
  }

  async function handleUpdateProductCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!shop || !editingProduct) {
      setFormError("Le produit ou la boutique n’est pas disponible.");
      return;
    }
    setUpdatingProduct(true);
    setFormError("");
    setFeedback("");
    try {
      const { error } = await supabase
        .from("products")
        .update({ category_id: editCategoryId || null })
        .eq("id", editingProduct.id)
        .eq("shop_id", shop.id);
      if (error) throw new Error(error.message);

      const selectedCategory = categories.find((category) => category.id === editCategoryId);
      setProducts((previous) => previous.map((product) =>
        product.id === editingProduct.id
          ? { ...product, category_id: editCategoryId || null }
          : product,
      ));
      setFeedback(
        editCategoryId
          ? `Catégorie « ${selectedCategory?.name ?? "sélectionnée"} » attribuée à « ${editingProduct.name} ».`
          : `La catégorie de « ${editingProduct.name} » a été retirée.`,
      );
      setEditingProduct(null);
      setEditCategoryId("");
    } catch (updateError) {
      setFormError(updateError instanceof Error ? updateError.message : "Impossible de modifier la catégorie du produit.");
    } finally {
      setUpdatingProduct(false);
    }
  }

  function resetForm() {
    setName("");
    setBrand("");
    setCategoryId("");
    setDescription("");
    setProductImage(null);
    setProductImagePreview("");
    setSize("");
    setColor("");
    setBarcode("");
    setPurchasePrice("");
    setSellingPrice("");
    setLowStockThreshold("5");
    setFormError("");
  }

  async function handleCreateProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!shop) {
      setFormError("La boutique n’est pas disponible.");
      return;
    }
    const purchase = Number(purchasePrice);
    const selling = Number(sellingPrice);
    const threshold = Number(lowStockThreshold);
    if (
      !Number.isFinite(purchase) ||
      purchase < 0 ||
      !Number.isFinite(selling) ||
      selling < 0
    ) {
      setFormError("Saisis des prix valides, égaux ou supérieurs à zéro.");
      return;
    }
    if (!Number.isInteger(threshold) || threshold < 0) {
      setFormError(
        "Le seuil d’alerte doit être un nombre entier positif ou nul.",
      );
      return;
    }
    setSaving(true);
    setFormError("");
    setFeedback("");
    try {
      const { data: product, error: productError } = await supabase
        .from("products")
        .insert({
          shop_id: shop.id,
          name: name.trim(),
          brand: brand.trim() || null,
          category_id: categoryId || null,
          description: description.trim() || null,
          image_url: null,
          is_active: true,
        })
        .select("id")
        .single();
      if (productError || !product)
        throw new Error(
          productError?.message || "Le produit n’a pas pu être créé.",
        );

      if (productImage) {
        try {
          const uploaded = await uploadProductImage(shop.id, product.id, productImage);
          const { error: imageUpdateError } = await supabase
            .from("products")
            .update({ image_url: uploaded.url })
            .eq("id", product.id)
            .eq("shop_id", shop.id);
          if (imageUpdateError) {
            await supabase.storage.from(PRODUCT_IMAGE_BUCKET).remove([uploaded.path]);
            throw new Error(imageUpdateError.message);
          }
        } catch (imageError) {
          // Avoid leaving a half-created product if its optional image cannot be saved.
          await supabase.from("products").delete().eq("id", product.id).eq("shop_id", shop.id);
          throw new Error(`La photo n’a pas pu être enregistrée. Le produit n’a pas été conservé : ${imageError instanceof Error ? imageError.message : "erreur inconnue"}`);
        }
      }

      // Create one initial variant; stock always starts at zero and is recorded later through stock movements.
      const sku = `SW-${crypto.randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`;
      const { error: variantError } = await supabase
        .from("product_variants")
        .insert({
          shop_id: shop.id,
          product_id: product.id,
          sku,
          size: size.trim() || null,
          color: color.trim() || null,
          barcode: barcode.trim() || null,
          purchase_price: purchase,
          selling_price: selling,
          stock_quantity: 0,
          low_stock_threshold: threshold,
          is_active: true,
        });
      if (variantError) {
        // Avoid leaving a product with no variant when the variant insert fails.
        await supabase
          .from("products")
          .delete()
          .eq("id", product.id)
          .eq("shop_id", shop.id);
        throw new Error(
          `Produit non enregistré complètement : ${variantError.message}`,
        );
      }
      setFeedback(
        `Produit créé avec succès. Référence générée : ${sku}. Le stock est à 0 jusqu’à l’enregistrement d’une entrée.`,
      );
      setShowForm(false);
      resetForm();
      await loadCatalog();
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : "Une erreur est survenue pendant la création.",
      );
    } finally {
      setSaving(false);
    }
  }

  function resetVariantForm() {
    setVariantSize("");
    setVariantColor("");
    setVariantBarcode("");
    setVariantPurchasePrice("");
    setVariantSellingPrice("");
    setVariantThreshold("5");
    setAddingVariantTo(null);
    setFormError("");
  }

  async function handleAddVariant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!shop || !addingVariantTo) {
      setFormError("Sélectionne un produit parent avant d’ajouter une variante.");
      return;
    }
    const purchase = Number(variantPurchasePrice);
    const selling = Number(variantSellingPrice);
    const threshold = Number(variantThreshold);
    if (!Number.isFinite(purchase) || purchase < 0 || !Number.isFinite(selling) || selling < 0) {
      setFormError("Saisis des prix valides, égaux ou supérieurs à zéro.");
      return;
    }
    if (!Number.isInteger(threshold) || threshold < 0) {
      setFormError("Le seuil d’alerte doit être un nombre entier positif ou nul.");
      return;
    }
    setVariantSaving(true);
    setFormError("");
    setFeedback("");
    try {
      const sku = `SW-${crypto.randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`;
      const { error } = await supabase.from("product_variants").insert({
        shop_id: shop.id,
        product_id: addingVariantTo.id,
        sku,
        size: variantSize.trim() || null,
        color: variantColor.trim() || null,
        barcode: variantBarcode.trim() || null,
        purchase_price: purchase,
        selling_price: selling,
        stock_quantity: 0,
        low_stock_threshold: threshold,
        is_active: true,
      });
      if (error) throw new Error(error.message);
      const parentName = addingVariantTo.name;
      resetVariantForm();
      setFeedback(`Variante ajoutée à « ${parentName} ». Référence générée : ${sku}. Le stock est à 0 jusqu’à l’enregistrement d’une entrée.`);
      await loadCatalog();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Impossible d’ajouter cette variante.");
    } finally {
      setVariantSaving(false);
    }
  }

  function startEditingVariant(
    product: ProductRow,
    variant: NonNullable<ProductRow["product_variants"]>[number],
  ) {
    setEditingVariant({ product, variant });
    setEditVariantSize(variant.size ?? "");
    setEditVariantColor(variant.color ?? "");
    setEditVariantBarcode(variant.barcode ?? "");
    setEditVariantPurchasePrice(String(variant.purchase_price));
    setEditVariantSellingPrice(String(variant.selling_price));
    setEditVariantThreshold(String(variant.low_stock_threshold));
    setFormError("");
    setFeedback("");
    setAddingVariantTo(null);
  }

  function resetEditingVariant() {
    setEditingVariant(null);
    setEditVariantSize("");
    setEditVariantColor("");
    setEditVariantBarcode("");
    setEditVariantPurchasePrice("");
    setEditVariantSellingPrice("");
    setEditVariantThreshold("5");
    setFormError("");
  }

  async function handleUpdateVariant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!shop || !editingVariant) {
      setFormError("Sélectionne une variante à modifier.");
      return;
    }

    const purchase = Number(editVariantPurchasePrice);
    const selling = Number(editVariantSellingPrice);
    const threshold = Number(editVariantThreshold);

    if (!Number.isFinite(purchase) || purchase < 0 || !Number.isFinite(selling) || selling < 0) {
      setFormError("Saisis des prix valides, égaux ou supérieurs à zéro.");
      return;
    }
    if (!Number.isInteger(threshold) || threshold < 0) {
      setFormError("Le seuil d’alerte doit être un nombre entier positif ou nul.");
      return;
    }

    setUpdatingVariant(true);
    setFormError("");
    setFeedback("");
    try {
      const { error } = await supabase
        .from("product_variants")
        .update({
          size: editVariantSize.trim() || null,
          color: editVariantColor.trim() || null,
          barcode: editVariantBarcode.trim() || null,
          purchase_price: purchase,
          selling_price: selling,
          low_stock_threshold: threshold,
        })
        .eq("id", editingVariant.variant.id)
        .eq("shop_id", shop.id)
        .eq("product_id", editingVariant.product.id);

      if (error) throw new Error(error.message);
      const variantLabel = [editVariantSize.trim(), editVariantColor.trim()].filter(Boolean).join(" · ") || "Variante standard";
      resetEditingVariant();
      setFeedback(`Variante « ${variantLabel} » mise à jour. La référence et le stock ont été conservés.`);
      await loadCatalog();
    } catch (updateError) {
      setFormError(updateError instanceof Error ? updateError.message : "Impossible de modifier cette variante.");
    } finally {
      setUpdatingVariant(false);
    }
  }

  async function handleArchiveProduct(product: ProductRow) {
    if (!shop) return;
    const isCurrentlyActive = product.is_active;
    const actionLabel = isCurrentlyActive ? "archiver" : "restaurer";
    const confirmation = isCurrentlyActive
      ? `Archiver « ${product.name} » ? Le produit et ses variantes ne seront plus proposés dans le catalogue actif. L’historique de stock sera conservé.`
      : `Restaurer « ${product.name} » dans le catalogue actif ?`;
    if (!window.confirm(confirmation)) return;

    setProductActionId(product.id);
    setFormError("");
    setFeedback("");
    try {
      const nextActive = !isCurrentlyActive;
      const { error: productError } = await supabase
        .from("products")
        .update({ is_active: nextActive })
        .eq("id", product.id)
        .eq("shop_id", shop.id);
      if (productError) throw new Error(productError.message);

      const { error: variantsError } = await supabase
        .from("product_variants")
        .update({ is_active: nextActive })
        .eq("product_id", product.id)
        .eq("shop_id", shop.id);
      if (variantsError) {
        // Roll back the product flag if its variants could not be updated.
        await supabase.from("products")
          .update({ is_active: isCurrentlyActive })
          .eq("id", product.id)
          .eq("shop_id", shop.id);
        throw new Error(variantsError.message);
      }

      setProducts((previous) => previous.map((item) =>
        item.id === product.id
          ? {
              ...item,
              is_active: nextActive,
              product_variants: (item.product_variants ?? []).map((variant) => ({
                ...variant,
                is_active: nextActive,
              })),
            }
          : item,
      ));
      setExpandedProducts((previous) => previous.filter((id) => id !== product.id));
      setFeedback(nextActive
        ? `Le produit « ${product.name} » a été restauré.`
        : `Le produit « ${product.name} » a été archivé. Son historique est conservé.`);
    } catch (actionError) {
      setFormError(actionError instanceof Error ? actionError.message : `Impossible de ${actionLabel} ce produit.`);
    } finally {
      setProductActionId(null);
    }
  }

  async function handleDeleteProduct(product: ProductRow) {
    if (!shop) return;
    const variants = product.product_variants ?? [];
    if (variants.length === 0) {
      setFormError("Ce produit ne peut pas être supprimé automatiquement, car aucune variante n’est disponible. Archive-le plutôt.");
      return;
    }
    if (!window.confirm(`Supprimer définitivement « ${product.name} » ? Cette action est réservée aux produits sans historique de stock et ne peut pas être annulée.`)) return;

    setProductActionId(product.id);
    setFormError("");
    setFeedback("");
    try {
      const variantIds = variants.map((variant) => variant.id);
      const { data: movements, error: movementError } = await supabase
        .from("stock_movements")
        .select("id")
        .eq("shop_id", shop.id)
        .in("variant_id", variantIds)
        .limit(1);
      if (movementError) throw new Error(movementError.message);
      if ((movements ?? []).length > 0) {
        setFeedback(`« ${product.name} » possède déjà un historique de stock. Il vaut mieux l’archiver pour conserver cet historique.`);
        return;
      }

      const { error: variantDeleteError } = await supabase
        .from("product_variants")
        .delete()
        .eq("product_id", product.id)
        .eq("shop_id", shop.id);
      if (variantDeleteError) throw new Error(variantDeleteError.message);

      const { error: productDeleteError } = await supabase
        .from("products")
        .delete()
        .eq("id", product.id)
        .eq("shop_id", shop.id);
      if (productDeleteError) throw new Error(productDeleteError.message);

      setProducts((previous) => previous.filter((item) => item.id !== product.id));
      setExpandedProducts((previous) => previous.filter((id) => id !== product.id));
      setFeedback(`Le produit « ${product.name} » a été supprimé.`);
    } catch (actionError) {
      setFormError(actionError instanceof Error ? actionError.message : "Impossible de supprimer ce produit.");
    } finally {
      setProductActionId(null);
    }
  }

  const filteredProducts = products.filter((product) => {
    if (showArchivedProducts ? product.is_active : !product.is_active) return false;
    const query = search.trim().toLocaleLowerCase();
    if (!query) return true;
    const matchesCategory = categoryFilter === "all" || product.category_id === categoryFilter;
    if (!matchesCategory) return false;
    return (
      product.name.toLocaleLowerCase().includes(query) ||
      (product.brand ?? "").toLocaleLowerCase().includes(query) ||
      (product.product_variants ?? []).some(
        (variant) =>
          variant.sku.toLocaleLowerCase().includes(query) ||
          (variant.barcode ?? "").toLocaleLowerCase().includes(query),
      )
    );
  });

  return (
    <section className="catalog-page">
      <div className="catalog-heading">
        <div>
          <span className="section-eyebrow">CATALOGUE DE LA BOUTIQUE</span>
          <h1>Produits</h1>
          <p>
            Crée tes articles et leurs références avant d’enregistrer les
            quantités en stock.
          </p>
        </div>
        <div className="catalog-heading-actions">
          <button className="secondary-button category-manager-toggle" type="button" onClick={() => { setShowCategoryManager((value) => !value); setFormError(""); }}>
            {showCategoryManager ? "Fermer les catégories" : `Gérer les catégories (${categories.length})`}
          </button>
          <button
            className="primary-button catalog-add-button"
            type="button"
            onClick={() => { setShowForm((value) => !value); setFormError(""); }}
          >
            <span aria-hidden="true">＋</span>{" "}
            {showForm ? "Fermer le formulaire" : "Ajouter un produit"}
          </button>
        </div>
      </div>

      {feedback && (
        <div className="catalog-notice" role="status">
          {feedback}
          <button
            type="button"
            onClick={() => setFeedback("")}
            aria-label="Fermer"
          >
            ×
          </button>
        </div>
      )}

      {showCategoryManager && (
        <section className="category-manager-card" aria-label="Gestion des catégories">
          <div className="category-manager-heading"><div><span className="section-eyebrow">ORGANISATION DU CATALOGUE</span><h2>Gérer les catégories</h2><p>Crée les catégories utilisées pour classer tes produits.</p></div><span className="category-manager-count">{categories.length} catégorie(s)</span></div>
          <form className="category-create-form" onSubmit={handleCreateCategory}>
            <label htmlFor="new-category-name">Nom de la catégorie</label>
            <div className="category-create-controls"><input id="new-category-name" value={categoryName} onChange={(event) => setCategoryName(event.target.value)} placeholder="Ex. Vêtements, Chaussures, Jouets" maxLength={80} required /><button className="primary-button" type="submit" disabled={categorySaving || !shop}>{categorySaving ? "Création..." : "＋ Créer la catégorie"}</button></div>
          <div className="category-suggestions" aria-label="Suggestions de catégories">{["Vêtements", "Chaussures", "Jouets", "Accessoires", "Autres"].map((suggestion) => <button key={suggestion} type="button" className="category-suggestion" onClick={() => setCategoryName(suggestion)}>{suggestion}</button>)}</div>
          </form>
          {categories.length === 0 ? <div className="category-manager-empty">Aucune catégorie pour le moment. Crée ta première catégorie ci-dessus.</div> : <div className="category-chip-list">{categories.map((category) => { const used = products.filter((product) => product.category_id === category.id).length; return <div className="category-chip-row" key={category.id}><div className="category-chip-icon" aria-hidden="true">#</div><div className="category-chip-copy"><strong>{category.name}</strong><span>{used} produit{used === 1 ? "" : "s"} associé{used === 1 ? "" : "s"}</span></div><button className="category-delete-button" type="button" onClick={() => void handleDeleteCategory(category)} disabled={used > 0} title={used > 0 ? "Cette catégorie est utilisée par un produit" : "Supprimer la catégorie"}>Supprimer</button></div>; })}</div>}
        </section>
      )}

      {showForm && (
        <form className="product-form-card" onSubmit={handleCreateProduct}>
          <div className="product-form-heading">
            <div>
              <h2>Nouveau produit</h2>
              <p>
                Le stock initial sera de 0. Tu l’ajouteras dans Gestion du
                stock.
              </p>
            </div>
          </div>
          <div className="product-form-grid">
            <label>
              Nom du produit *
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex. T-shirt coton"
                required
                maxLength={120}
              />
            </label>
            <label>
              Marque
              <input
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                placeholder="Ex. Nike"
                maxLength={100}
              />
            </label>
            <label>
              Catégorie
              <select
                value={categoryId}
                onChange={(e) => { setCategoryId(e.target.value); setSize(""); setColor(""); }}
              >
                <option value="">Sans catégorie</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Description
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Détails utiles sur le produit"
                rows={3}
                maxLength={1000}
              />
            </label>
            <div className="product-image-field">
              <label htmlFor="new-product-image">Photo du produit (facultative)</label>
              <input id="new-product-image" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={(event) => {
                const file = event.target.files?.[0] ?? null;
                setProductImage(file);
                setProductImagePreview(file ? URL.createObjectURL(file) : "");
                setFormError("");
              }} />
              <small>JPG, PNG ou WebP · 5 Mo maximum. Sur téléphone, tu peux prendre une photo ou choisir dans la galerie.</small>
              {productImagePreview && <div className="product-image-preview"><img src={productImagePreview} alt="Aperçu de la photo du produit" /><button type="button" className="secondary-button" onClick={() => { setProductImage(null); setProductImagePreview(""); const input = document.getElementById("new-product-image") as HTMLInputElement | null; if (input) input.value = ""; }}>Retirer la photo</button></div>}
            </div>
          </div>
          <div className="variant-form-heading">
            <h3>Première variante</h3>
            <p>
              {selectedCategoryKind === "shoes"
                ? "La pointure et la couleur sont facultatives. Chaque variante possède sa propre référence."
                : selectedCategoryKind === "clothing"
                  ? "La taille et la couleur sont facultatives. Chaque variante possède sa propre référence."
                  : "Les articles simples n’ont pas besoin de taille ni de couleur. Le stock sera enregistré séparément."}
            </p>
          </div>
          <div className="product-form-grid product-variant-grid">
            {selectedCategoryKind !== "general" && (
              <>
                <label>
                  {initialVariantDimensionLabel}
                  <input
                    value={size}
                    onChange={(e) => setSize(e.target.value)}
                    placeholder={selectedCategoryKind === "shoes" ? "Ex. 38, 39, 40" : "Ex. S, M, L"}
                    maxLength={40}
                  />
                </label>
                <label>
                  Couleur (facultatif)
                  <input
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                    placeholder="Ex. Blanc"
                    maxLength={60}
                  />
                </label>
              </>
            )}
            <label>
              Code-barres (facultatif)
              <input
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                placeholder="Scanner ou saisir le code"
                maxLength={120}
                autoComplete="off"
              />
            </label>
            <label>
              Prix d’achat ({shop?.currency_code ?? "CDF"}) *
              <input
                type="number"
                min="0"
                step="any"
                value={purchasePrice}
                onChange={(e) => setPurchasePrice(e.target.value)}
                required
                placeholder="0"
              />
            </label>
            <label>
              Prix de vente ({shop?.currency_code ?? "CDF"}) *
              <input
                type="number"
                min="0"
                step="any"
                value={sellingPrice}
                onChange={(e) => setSellingPrice(e.target.value)}
                required
                placeholder="0"
              />
            </label>
            <label>
              Seuil d’alerte de stock
              <input
                type="number"
                min="0"
                step="1"
                value={lowStockThreshold}
                onChange={(e) => setLowStockThreshold(e.target.value)}
                required
              />
            </label>
          </div>
          <div className="variant-stock-note">
            <Icon name="stock" size={18} />
            <span>
              Référence interne générée automatiquement. Aucun stock ni
              mouvement de stock ne sera créé pour le moment.
            </span>
          </div>
          {formError && (
            <p className="catalog-error" role="alert">
              {formError}
            </p>
          )}
          <div className="product-form-actions">
            <button
              className="secondary-button"
              type="button"
              onClick={() => {
                setShowForm(false);
                resetForm();
              }}
            >
              Annuler
            </button>
            <button
              className="primary-button"
              type="submit"
              disabled={saving || !shop}
            >
              {saving ? "Enregistrement..." : "Créer le produit"}
            </button>
          </div>
        </form>
      )}

      {!showForm && formError && (
        <p className="catalog-error" role="alert">
          {formError}
        </p>
      )}
      <div className="catalog-toolbar">
        <label className="catalog-search">
          <Icon name="products" size={18} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher un produit, une marque ou une référence..."
          />
        </label>
        <label className="catalog-category-filter"><span>Catégorie</span><select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}><option value="all">Toutes les catégories</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
        <button
          className="product-edit-button"
          type="button"
          onClick={() => setShowArchivedProducts((value) => !value)}
        >
          {showArchivedProducts ? "Voir les produits actifs" : "Voir les produits archivés"}
        </button>
        <span className="catalog-count">
          {filteredProducts.length} produit{filteredProducts.length !== 1 ? "s" : ""}
          {showArchivedProducts ? " archivé(s)" : " actif(s)"}
        </span>
      </div>
      {addingVariantTo && (
        <form className="product-form-card add-variant-card" onSubmit={handleAddVariant}>
          <div className="product-form-heading">
            <div><span className="section-eyebrow">VARIANTE DU PRODUIT</span><h2>Ajouter une variante</h2><p>Produit parent : <strong>{addingVariantTo.name}</strong>. {addedVariantCategoryKind === "shoes" ? "La pointure et la couleur sont facultatives." : addedVariantCategoryKind === "clothing" ? "La taille et la couleur sont facultatives." : "Cette variante peut rester standard, sans taille ni couleur."} Une nouvelle référence sera générée.</p></div>
            <button className="secondary-button" type="button" onClick={resetVariantForm}>Fermer</button>
          </div>
          <div className="product-form-grid product-variant-grid">
            {addedVariantCategoryKind !== "general" && <>
              <label>{addedVariantDimensionLabel}<input value={variantSize} onChange={(e) => setVariantSize(e.target.value)} placeholder={addedVariantCategoryKind === "shoes" ? "Ex. 38, 39, 40" : "Ex. S, M, L"} maxLength={40} /></label>
              <label>Couleur (facultatif)<input value={variantColor} onChange={(e) => setVariantColor(e.target.value)} placeholder="Ex. Blanc" maxLength={60} /></label>
            </>}
            <label>Code-barres (facultatif)<input value={variantBarcode} onChange={(e) => setVariantBarcode(e.target.value)} placeholder="Scanner ou saisir le code" maxLength={120} autoComplete="off" /></label>
            <label>Prix d’achat ({shop?.currency_code ?? "CDF"}) *<input type="number" min="0" step="any" value={variantPurchasePrice} onChange={(e) => setVariantPurchasePrice(e.target.value)} required placeholder="0" /></label>
            <label>Prix de vente ({shop?.currency_code ?? "CDF"}) *<input type="number" min="0" step="any" value={variantSellingPrice} onChange={(e) => setVariantSellingPrice(e.target.value)} required placeholder="0" /></label>
            <label>Seuil d’alerte de stock<input type="number" min="0" step="1" value={variantThreshold} onChange={(e) => setVariantThreshold(e.target.value)} required /></label>
          </div>
          {formError && <p className="catalog-error" role="alert">{formError}</p>}
          <div className="variant-stock-note"><Icon name="stock" size={18} /><span>Stock initial : 0. Enregistre ensuite une entrée dans Gestion du stock pour renseigner la quantité disponible.</span></div>
          <div className="product-form-actions"><button className="secondary-button" type="button" onClick={resetVariantForm}>Annuler</button><button className="primary-button" type="submit" disabled={variantSaving || !shop}>{variantSaving ? "Ajout..." : "Ajouter la variante"}</button></div>
        </form>
      )}

      {editingVariant && (
        <form className="product-form-card add-variant-card" onSubmit={handleUpdateVariant}>
          <div className="product-form-heading">
            <div>
              <span className="section-eyebrow">MODIFICATION DE VARIANTE</span>
              <h2>Modifier une variante</h2>
              <p>Produit : <strong>{editingVariant.product.name}</strong> · Référence : <strong>{editingVariant.variant.sku}</strong>. Le stock et la référence ne seront pas modifiés.</p>
            </div>
            <button className="secondary-button" type="button" onClick={resetEditingVariant}>Fermer</button>
          </div>
          <div className="product-form-grid product-variant-grid">
            {editedVariantCategoryKind !== "general" && <>
              <label>{editedVariantDimensionLabel}<input value={editVariantSize} onChange={(e) => setEditVariantSize(e.target.value)} placeholder={editedVariantCategoryKind === "shoes" ? "Ex. 38, 39, 40" : "Ex. S, M, L"} maxLength={40} /></label>
              <label>Couleur (facultatif)<input value={editVariantColor} onChange={(e) => setEditVariantColor(e.target.value)} placeholder="Ex. Blanc" maxLength={60} /></label>
            </>}
            <label>Code-barres (facultatif)<input value={editVariantBarcode} onChange={(e) => setEditVariantBarcode(e.target.value)} placeholder="Scanner ou saisir le code" maxLength={120} autoComplete="off" /></label>
            <label>Prix d’achat ({shop?.currency_code ?? "CDF"}) *<input type="number" min="0" step="any" value={editVariantPurchasePrice} onChange={(e) => setEditVariantPurchasePrice(e.target.value)} required /></label>
            <label>Prix de vente ({shop?.currency_code ?? "CDF"}) *<input type="number" min="0" step="any" value={editVariantSellingPrice} onChange={(e) => setEditVariantSellingPrice(e.target.value)} required /></label>
            <label>Seuil d’alerte de stock<input type="number" min="0" step="1" value={editVariantThreshold} onChange={(e) => setEditVariantThreshold(e.target.value)} required /></label>
          </div>
          <div className="variant-stock-note"><Icon name="stock" size={18} /><span>Stock actuel : {editingVariant.variant.stock_quantity} unité(s). La quantité disponible ne sera pas touchée.</span></div>
          {formError && <p className="catalog-error" role="alert">{formError}</p>}
          <div className="product-form-actions">
            <button className="secondary-button" type="button" onClick={resetEditingVariant}>Annuler</button>
            <button className="primary-button" type="submit" disabled={updatingVariant || !shop}>{updatingVariant ? "Enregistrement..." : "Enregistrer les modifications"}</button>
          </div>
        </form>
      )}

      {editingProductDetails && (
        <form className="product-category-edit-card product-details-edit-card" onSubmit={handleUpdateProductDetails}>
          <div className="product-category-edit-heading">
            <div>
              <span className="section-eyebrow">MODIFICATION DU PRODUIT</span>
              <h2>Modifier les informations du produit</h2>
              <p>Produit : <strong>{editingProductDetails.name}</strong>. Les références, les prix des variantes et les quantités en stock ne seront pas modifiés.</p>
            </div>
            <button className="secondary-button" type="button" onClick={cancelEditingProductDetails}>Annuler</button>
          </div>
          <div className="product-details-edit-grid">
            <label>Nom du produit *<input value={editProductName} onChange={(event) => setEditProductName(event.target.value)} required maxLength={150} /></label>
            <label>Marque<input value={editProductBrand} onChange={(event) => setEditProductBrand(event.target.value)} maxLength={100} placeholder="Ex. Nike" /></label>
            <label>Catégorie<select value={editProductCategoryId} onChange={(event) => setEditProductCategoryId(event.target.value)}><option value="">Sans catégorie</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
            <label className="product-details-description">Description<textarea value={editProductDescription} onChange={(event) => setEditProductDescription(event.target.value)} rows={3} maxLength={2000} placeholder="Détails utiles sur le produit" /></label>
            <div className="product-image-field product-image-field-edit">
              <label htmlFor="edit-product-image">Photo du produit (facultative)</label>
              <input id="edit-product-image" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={(event) => {
                const file = event.target.files?.[0] ?? null;
                setEditProductImage(file);
                setEditProductImagePreview(file ? URL.createObjectURL(file) : (editingProductDetails.image_url ?? ""));
                setRemoveEditProductImage(false);
                setFormError("");
              }} />
              <small>JPG, PNG ou WebP · 5 Mo maximum.</small>
              {editProductImagePreview && <div className="product-image-preview"><img src={editProductImagePreview} alt="Aperçu de la photo du produit" /><button type="button" className="secondary-button" onClick={() => { setEditProductImage(null); setEditProductImagePreview(""); setRemoveEditProductImage(true); const input = document.getElementById("edit-product-image") as HTMLInputElement | null; if (input) input.value = ""; }}>Supprimer la photo</button></div>}
              {!editProductImagePreview && editingProductDetails.image_url && <small>La photo actuelle sera supprimée à l’enregistrement.</small>}
            </div>
          </div>
          {formError && <p className="catalog-error" role="alert">{formError}</p>}
          <div className="product-form-actions">
            <button className="secondary-button" type="button" onClick={cancelEditingProductDetails}>Annuler</button>
            <button className="primary-button" type="submit" disabled={updatingProduct || !shop}>{updatingProduct ? "Enregistrement..." : "Enregistrer le produit"}</button>
          </div>
        </form>
      )}

      {editingProduct && (
        <form className="product-category-edit-card" onSubmit={handleUpdateProductCategory}>
          <div className="product-category-edit-heading">
            <div>
              <span className="section-eyebrow">MODIFICATION DU PRODUIT</span>
              <h2>Attribuer une catégorie</h2>
              <p>Produit : <strong>{editingProduct.name}</strong>. Cette modification ne change ni la référence, ni les prix, ni le stock.</p>
            </div>
            <button className="secondary-button" type="button" onClick={() => { setEditingProduct(null); setEditCategoryId(""); setFormError(""); }}>Annuler</button>
          </div>
          <label className="product-category-edit-field" htmlFor="edit-product-category">Catégorie</label>
          <div className="product-category-edit-controls">
            <select id="edit-product-category" value={editCategoryId} onChange={(event) => setEditCategoryId(event.target.value)}>
              <option value="">Sans catégorie</option>
              {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
            <button className="primary-button" type="submit" disabled={updatingProduct || !shop}>{updatingProduct ? "Enregistrement..." : "Enregistrer la catégorie"}</button>
          </div>
          {formError && <p className="catalog-error" role="alert">{formError}</p>}
        </form>
      )}

      <div className="catalog-table-card">
        {loading ? (
          <div className="catalog-empty">
            <span className="loading-spinner" />
            <p>Chargement du catalogue...</p>
          </div>
        ) : filteredProducts.length === 0 ? (
          <div className="catalog-empty">
            <div className="catalog-empty-icon">
              <Icon name="products" size={26} />
            </div>
            <h2>
              {search ? "Aucun résultat" : "Ton catalogue est encore vide"}
            </h2>
            <p>
              {search
                ? "Essaie avec un autre terme."
                : "Ajoute ton premier produit pour commencer à organiser ta boutique."}
            </p>
            {!search && (
              <button
                className="primary-button"
                type="button"
                onClick={() => setShowForm(true)}
              >
                ＋ Ajouter un produit
              </button>
            )}
          </div>
        ) : (
          <div className="catalog-table-wrap">
            <table className="catalog-table">
              <thead>
                <tr>
                  <th>Produit</th>
                  <th>Catégorie</th>
                  <th>Référence</th>
                  <th>Prix de vente</th>
                  <th>Stock</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredProducts.map((product) => {
                  const variants = (product.product_variants ?? []).filter((variant) => variant.is_active);
                  const category = categories.find((item) => item.id === product.category_id)?.name ?? "—";
                  const totalStock = variants.reduce((total, variant) => total + Number(variant.stock_quantity || 0), 0);
                  const expanded = expandedProducts.includes(product.id);
                  return (
                    <Fragment key={product.id}>
                      <tr className="catalog-parent-row">
                        <td>
                          <div className="catalog-product-name">
                            {product.image_url ? <img className="catalog-product-thumb" src={product.image_url} alt="" loading="lazy" /> : <span className="catalog-product-thumb catalog-product-thumb-placeholder" aria-hidden="true">▧</span>}
                            <div>
                              <strong>{product.name}</strong>
                              <span>{[product.brand, `${variants.length} variante${variants.length === 1 ? "" : "s"}`].filter(Boolean).join(" · ")}</span>
                            </div>
                          </div>
                        </td>
                        <td>{category}</td>
                        <td>{variants.length} référence(s)</td>
                        <td>{variants.length ? `${Math.min(...variants.map((v) => Number(v.selling_price))).toLocaleString("fr-FR")} ${shop?.currency_code ?? "CDF"}${variants.some((v) => Number(v.selling_price) !== Number(variants[0].selling_price)) ? " +" : ""}` : "—"}</td>
                        <td><span className={`stock-pill${totalStock > 0 ? " stock-pill-in" : ""}`}>{totalStock}</span></td>
                        <td className="catalog-parent-actions">
                          <button className="product-edit-button" type="button" onClick={() => { setAddingVariantTo(product); setEditingProductDetails(null); setFormError(""); }}>+ Variante</button>
                          <button className="product-edit-button" type="button" onClick={() => setExpandedProducts((previous) => expanded ? previous.filter((id) => id !== product.id) : [...previous, product.id])}>{expanded ? "Masquer" : "Détails"}</button>
                          <button className="product-edit-button" type="button" onClick={() => startEditingProductDetails(product)}>Modifier produit</button>
                          <button
                            className="product-edit-button"
                            type="button"
                            disabled={productActionId === product.id}
                            onClick={() => void handleArchiveProduct(product)}
                          >
                            {productActionId === product.id ? "..." : product.is_active ? "Archiver" : "Restaurer"}
                          </button>
                          {product.is_active && (
                            <button
                              className="product-edit-button product-delete-button"
                              type="button"
                              disabled={productActionId === product.id}
                              onClick={() => void handleDeleteProduct(product)}
                            >
                              Supprimer
                            </button>
                          )}
                        </td>
                      </tr>
                      {expanded && (
                        <tr key={`${product.id}-variants`} className="catalog-variants-row">
                          <td colSpan={6}>
                            <div className="catalog-variants-panel">
                              <div className="catalog-variants-heading"><strong>Variantes de {product.name}</strong><span>Chaque variante possède sa propre référence et son propre stock.</span></div>
                              {variants.length === 0 ? <p className="catalog-variants-empty">Aucune variante active pour ce produit.</p> : (
                                <div className="catalog-variants-list">
                                  {variants.map((variant) => (
                                    <div className="catalog-variant-item" key={variant.id}>
                                      <div className="catalog-variant-description"><strong>{[variant.size, variant.color].filter(Boolean).join(" · ") || "Variante standard"}</strong><code>{variant.sku}</code>{variant.barcode && <span>Code-barres : {variant.barcode}</span>}</div>
                                      <div><small>Prix de vente</small><strong>{Number(variant.selling_price).toLocaleString("fr-FR")} {shop?.currency_code ?? "CDF"}</strong></div>
                                      <div><small>Stock</small><span className={`stock-pill${Number(variant.stock_quantity) > 0 ? " stock-pill-in" : ""}`}>{variant.stock_quantity}</span></div>
                                      <div><small>Seuil d’alerte</small><strong>{variant.low_stock_threshold}</strong></div>
                                      <button className="product-edit-button" type="button" onClick={() => startEditingVariant(product, variant)}>Modifier</button>
                                    </div>
                                  ))}
                                </div>
                              )}
                              <button className="secondary-button" type="button" onClick={() => setAddingVariantTo(product)}>＋ Ajouter une variante à ce produit</button>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

type ScannedVariant = {
  id: string;
  barcode: string;
  barcode_source: string;
  supplier_barcode: string | null;
  status: string;
  variant_id: string;
  item_kind: "individual" | "variant";
  stock_quantity?: number;
  product_variants?: {
    sku: string;
    size: string | null;
    color: string | null;
    stock_quantity?: number;
    products?: { name: string } | null;
  } | null;
};

function ScannerModule({ shop }: { shop: Shop | null }) {
  const [manualCode, setManualCode] = useState("");
  const [item, setItem] = useState<ScannedVariant | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [searching, setSearching] = useState(false);


  async function findItem(codeValue: string) {
    const code = codeValue.trim();
    if (!code || !shop) return;
    setManualCode(code);
    setError("");
    setMessage("");
    setItem(null);
    setSearching(true);

    try {
      // Priorité au code unique de la pièce physique.
      const { data: individualItem, error: individualError } = await supabase
        .from("variant_items")
        .select("id, barcode, barcode_source, supplier_barcode, status, variant_id, product_variants(sku, size, color, products(name))")
        .eq("shop_id", shop.id)
        .eq("barcode", code)
        .maybeSingle();

      if (individualError) throw new Error(individualError.message);

      if (individualItem) {
        setItem({ ...(individualItem as unknown as ScannedVariant), item_kind: "individual" });
        setMessage("Pièce individuelle retrouvée. Le stock n’a pas été modifié.");
        return;
      }

      // Si ce n’est pas un code individuel, chercher le code de la variante.
      const { data: variant, error: variantError } = await supabase
        .from("product_variants")
        .select("id, sku, barcode, size, color, stock_quantity, products(name)")
        .eq("shop_id", shop.id)
        .eq("barcode", code)
        .maybeSingle();

      if (variantError) throw new Error(variantError.message);

      if (variant) {
        setItem({
          id: variant.id,
          barcode: variant.barcode ?? code,
          barcode_source: "variant",
          supplier_barcode: null,
          status: "variant",
          variant_id: variant.id,
          item_kind: "variant",
          stock_quantity: variant.stock_quantity,
          product_variants: {
            sku: variant.sku,
            size: variant.size,
            color: variant.color,
            stock_quantity: variant.stock_quantity,
            products: Array.isArray(variant.products) ? variant.products[0] ?? null : variant.products,
          },
        } as ScannedVariant);
        setMessage("Variante retrouvée. Le stock affiché correspond à la quantité totale de cette variante.");
        return;
      }

      setMessage("Aucun article trouvé pour ce code dans cette boutique. Vérifie le code ou recherche l’article dans le catalogue.");
    } catch (lookupError) {
      setError(`Impossible de rechercher ce code : ${lookupError instanceof Error ? lookupError.message : "erreur inconnue"}`);
    } finally {
      setSearching(false);
    }
  }


  const statusLabel: Record<string, string> = {
    available: "Disponible",
    sold: "Vendu",
    return_pending_inspection: "Retour à inspecter",
    damaged: "Endommagé",
    variant: "Variante du catalogue",
  };

  return (
    <section className="catalog-page stock-scan-page">
      <div className="catalog-heading">
        <div>
          <span className="section-eyebrow">LECTURE PAR CODE-BARRES</span>
          <h1>Scanner un article</h1>
          <p>Scanne un code individuel pour identifier une pièce, ou le code de la variante pour consulter son stock total.</p>
        </div>
      </div>
      {!shop && <p className="catalog-error" role="alert">La boutique n’est pas disponible.</p>}
      {error && <p className="catalog-error" role="alert">{error}</p>}
      {message && <div className="catalog-notice" role="status">{message}</div>}

      <PhoneScanConnector shop={shop} title="Scanner" onBarcode={findItem} />

      <form className="product-form-card stock-scan-manual" onSubmit={(event) => { event.preventDefault(); void findItem(manualCode); }}>
        <div className="product-form-heading">
          <div>
            <h2>Recherche manuelle</h2>
            <p>Tu peux aussi coller ou saisir le code-barres si la caméra ne le lit pas.</p>
          </div>
        </div>
        <div className="product-form-grid stock-scan-manual-grid">
          <label>Code-barres *
            <input value={manualCode} onChange={(event) => setManualCode(event.target.value)} placeholder="Ex. SW-..." autoComplete="off" required />
          </label>
          <div className="product-form-actions">
            <button className="primary-button" type="submit" disabled={!shop || searching}>{searching ? "Recherche..." : "Rechercher l’article"}</button>
          </div>
        </div>
      </form>

      {item && (
        <article className="product-form-card stock-scan-result">
          <div className="product-form-heading">
            <div>
              <h2>{item.item_kind === "individual" ? "Pièce identifiée" : "Variante identifiée"}</h2>
              <p>{item.item_kind === "individual" ? "Résultat de la recherche dans l’inventaire individuel." : "Résultat du catalogue : le stock indiqué concerne toute cette variante."}</p>
            </div>
          </div>
          <div className="stock-scan-result-grid">
            <div><span>Produit</span><strong>{item.product_variants?.products?.name ?? "Produit sans nom"}</strong></div>
            <div><span>Taille / pointure</span><strong>{item.product_variants?.size ?? "—"}</strong></div>
            <div><span>Couleur</span><strong>{item.product_variants?.color ?? "—"}</strong></div>
            <div><span>Référence</span><strong>{item.product_variants?.sku ?? "—"}</strong></div>
            <div><span>{item.item_kind === "individual" ? "Code individuel" : "Code de variante"}</span><code>{item.barcode}</code></div>
            {item.item_kind === "individual"
              ? <div><span>Statut de la pièce</span><strong className={`stock-scan-status stock-scan-status-${item.status}`}>{statusLabel[item.status] ?? item.status}</strong></div>
              : <div><span>Stock total de la variante</span><strong>{item.stock_quantity ?? item.product_variants?.stock_quantity ?? 0} pièce(s)</strong></div>}
          </div>
        </article>
      )}
      <p className="stock-scan-security"><Icon name="shield" size={16} /> La recherche est limitée à la boutique connectée. Le scan ne crée ni vente ni mouvement de stock.</p>
    </section>
  );
}


type SaleCartItem = {
  id: string;
  barcode: string;
  variant_id: string;
  productName: string;
  sku: string;
  size: string | null;
  color: string | null;
  unitPrice: number;
};

type SaleReceipt = {
  id: string;
  receipt_number: string;
  total_amount: number;
  item_count: number;
  created_at: string;
  items: SaleCartItem[];
};

function formatMoney(amount: number, currency = "CDF") {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(amount);
}

function SalesModule({ shop }: { shop: Shop | null }) {
  const [manualCode, setManualCode] = useState("");
  const [cart, setCart] = useState<SaleCartItem[]>([]);
  const [lookupBusy, setLookupBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [lastReceipt, setLastReceipt] = useState<SaleReceipt | null>(null);


  const total = cart.reduce((sum, item) => sum + item.unitPrice, 0);
  const currency = shop?.currency_code || "CDF";

  async function findAndAddItem(codeValue: string) {
    const code = codeValue.trim();
    if (!code || !shop || lookupBusy || saving) return;
    setManualCode(code);
    setError("");
    setMessage("");
    setLookupBusy(true);
    try {
      const { data, error: lookupError } = await supabase
        .from("variant_items")
        .select("id, barcode, status, variant_id, product_variants(id, sku, size, color, selling_price, stock_quantity, is_active, products(name, is_active))")
        .eq("shop_id", shop.id)
        .eq("barcode", code)
        .maybeSingle();

      if (lookupError) throw new Error(lookupError.message);
      if (!data) throw new Error("Aucun article individuel ne correspond à ce code dans cette boutique. Les codes de variante ne peuvent pas être vendus directement.");

      const row = data as unknown as {
        id: string;
        barcode: string;
        status: string;
        variant_id: string;
        product_variants: {
          id: string;
          sku: string;
          size: string | null;
          color: string | null;
          selling_price: number;
          stock_quantity: number;
          is_active: boolean;
          products: { name: string; is_active: boolean } | { name: string; is_active: boolean }[] | null;
        } | null;
      };
      const variant = row.product_variants;
      const product = Array.isArray(variant?.products) ? variant.products[0] : variant?.products;

      if (row.status !== "available") {
        throw new Error(`Cet article n’est pas disponible (statut : ${row.status}).`);
      }
      if (!variant || !variant.is_active || product?.is_active === false) {
        throw new Error("Ce produit ou cette variante est inactif.");
      }
      if (variant.stock_quantity < 1) {
        throw new Error("Le stock de cette variante est insuffisant.");
      }
      if (cart.some((item) => item.id === row.id)) {
        throw new Error("Cet article est déjà présent dans le panier.");
      }

      const cartItem: SaleCartItem = {
        id: row.id,
        barcode: row.barcode,
        variant_id: row.variant_id,
        productName: product?.name ?? "Produit",
        sku: variant.sku,
        size: variant.size,
        color: variant.color,
        unitPrice: Number(variant.selling_price),
      };
      setCart((previous) => previous.some((item) => item.id === cartItem.id) ? previous : [...previous, cartItem]);
      setManualCode("");
      setMessage(`${cartItem.productName} ajouté au panier. Le stock n’a pas encore été modifié.`);
    } catch (lookupError) {
      setError(lookupError instanceof Error ? lookupError.message : "Impossible de vérifier cet article.");
    } finally {
      setLookupBusy(false);
    }
  }

  async function confirmSale() {
    if (!shop || cart.length === 0 || saving) return;
    if (!window.confirm(`Confirmer la vente de ${cart.length} article(s) pour ${formatMoney(total, currency)} en espèces ?`)) return;

    setSaving(true);
    setError("");
    setMessage("");
    try {
      const snapshot = [...cart];
      const { data, error: saleError } = await supabase.rpc("complete_cash_sale", {
        p_shop_id: shop.id,
        p_variant_item_ids: snapshot.map((item) => item.id),
      });
      if (saleError) throw new Error(saleError.message);

      const result = Array.isArray(data) ? data[0] : data;
      if (!result?.sale_id || !result?.receipt_number) {
        throw new Error("La vente a été envoyée, mais le reçu n’a pas pu être confirmé. Vérifie l’historique des ventes avant de réessayer.");
      }

      setLastReceipt({
        id: result.sale_id,
        receipt_number: result.receipt_number,
        total_amount: Number(result.total_amount),
        item_count: Number(result.item_count),
        created_at: new Date().toISOString(),
        items: snapshot,
      });
      setCart([]);
      setManualCode("");
      setMessage("Vente enregistrée avec succès. Le stock a été mis à jour.");
    } catch (saleError) {
      setError(`Vente non confirmée : ${saleError instanceof Error ? saleError.message : "erreur inconnue"}. Vérifie l’historique avant de relancer une vente.`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="catalog-page stock-sales-page">
      <div className="catalog-heading">
        <div>
          <span className="section-eyebrow">ENCAISSEMENT</span>
          <h1>Nouvelle vente</h1>
          <p>Scanne chaque vêtement individuellement, puis confirme le paiement en espèces.</p>
        </div>
      </div>

      {error && <p className="catalog-error" role="alert">{error}</p>}
      {message && <div className="catalog-notice" role="status">{message}</div>}

      <PhoneScanConnector shop={shop} title="Ventes" onBarcode={findAndAddItem} />

      <div className="product-form-card stock-scan-card">
        <div className="product-form-heading">
          <div>
            <h2>1. Ajouter les articles</h2>
            <p>Scanne les articles avec le téléphone connecté ou saisis leur code-barres individuel ci-dessous.</p>
          </div>
        </div>
        <form className="stock-scan-manual" onSubmit={(event) => { event.preventDefault(); void findAndAddItem(manualCode); }}>
          <label htmlFor="sale-barcode">Code-barres individuel</label>
          <div className="product-form-grid stock-scan-manual-grid">
            <input id="sale-barcode" value={manualCode} onChange={(event) => setManualCode(event.target.value)} placeholder="Ex. SW-..." autoComplete="off" required disabled={lookupBusy || saving} />
            <div className="product-form-actions">
              <button className="primary-button" type="submit" disabled={!shop || lookupBusy || saving || !manualCode.trim()}>{lookupBusy ? "Vérification..." : "Ajouter au panier"}</button>
            </div>
          </div>
        </form>
      </div>

      <section className="product-form-card stock-sales-cart">
        <div className="product-form-heading">
          <div>
            <h2>2. Panier</h2>
            <p>{cart.length} article(s) · paiement en espèces</p>
          </div>
          {cart.length > 0 && <button className="secondary-button" type="button" onClick={() => setCart([])} disabled={saving}>Vider le panier</button>}
        </div>
        {cart.length === 0 ? (
          <p className="stock-scan-help">Aucun article dans le panier. Scanne un code individuel pour commencer.</p>
        ) : (
          <div className="stock-sales-cart-list">
            {cart.map((item) => (
              <article className="stock-sales-cart-item" key={item.id}>
                <div className="stock-sales-cart-item-main">
                  <strong>{item.productName}</strong>
                  <span>{[item.size, item.color, item.sku].filter(Boolean).join(" · ")}</span>
                  <code>{item.barcode}</code>
                </div>
                <strong>{formatMoney(item.unitPrice, currency)}</strong>
                <button className="secondary-button" type="button" onClick={() => setCart((previous) => previous.filter((row) => row.id !== item.id))} disabled={saving} aria-label={`Retirer ${item.productName} du panier`}>Retirer</button>
              </article>
            ))}
          </div>
        )}
        <div className="stock-sales-total">
          <span>Total à payer</span>
          <strong>{formatMoney(total, currency)}</strong>
        </div>
        <div className="stock-sales-payment">
          <span className="meta-pill-icon"><Icon name="wallet" size={18} /></span>
          <div><strong>Espèces</strong><span>Le stock est modifié uniquement après confirmation.</span></div>
        </div>
        <button className="primary-button stock-sales-confirm" type="button" onClick={() => void confirmSale()} disabled={!shop || cart.length === 0 || saving}>
          {saving ? "Enregistrement de la vente..." : "Confirmer la vente"}
        </button>
      </section>

      {lastReceipt && (
        <section className="product-form-card stock-sales-receipt" aria-label="Reçu de la dernière vente">
          <div className="product-form-heading">
            <div><span className="section-eyebrow">VENTE CONFIRMÉE</span><h2>Reçu {lastReceipt.receipt_number}</h2><p>{new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short", timeZone: shop?.timezone || "Africa/Lubumbashi" }).format(new Date(lastReceipt.created_at))}</p></div>
            <button className="secondary-button no-print" type="button" onClick={() => window.print()}>Imprimer le reçu</button>
          </div>
          <div className="stock-sales-receipt-items">
            {lastReceipt.items.map((item) => <div className="stock-sales-receipt-row" key={item.id}><span>{item.productName} · {item.barcode}</span><strong>{formatMoney(item.unitPrice, currency)}</strong></div>)}
          </div>
          <div className="stock-sales-total"><span>Total payé en espèces</span><strong>{formatMoney(lastReceipt.total_amount, currency)}</strong></div>
          <p className="stock-scan-help">Conserve ce numéro de reçu pour retrouver la vente dans le module Reçus.</p>
        </section>
      )}
      <p className="stock-scan-security"><Icon name="shield" size={16} /> Chaque article ne peut être vendu qu’une seule fois. Le serveur revérifie le statut, le stock et le prix au moment de la confirmation.</p>
    </section>
  );
}

type SaleHistoryRow = {
  id: string;
  receipt_number: string;
  total_amount: number;
  payment_method: string;
  created_at: string;
};

function ReceiptsModule({ shop }: { shop: Shop | null }) {
  const [sales, setSales] = useState<SaleHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function loadSales() {
      if (!shop) { setSales([]); setLoading(false); return; }
      setLoading(true);
      setError("");
      const { data, error: queryError } = await supabase
        .from("sales")
        .select("id, receipt_number, total_amount, payment_method, created_at")
        .eq("shop_id", shop.id)
        .order("created_at", { ascending: false })
        .limit(100);
      if (cancelled) return;
      if (queryError) setError(`Impossible de charger les reçus : ${queryError.message}`);
      else setSales((data ?? []) as SaleHistoryRow[]);
      setLoading(false);
    }
    void loadSales();
    return () => { cancelled = true; };
  }, [shop?.id]);

  return (
    <section className="catalog-page stock-receipts-page">
      <div className="catalog-heading"><div><span className="section-eyebrow">HISTORIQUE DES VENTES</span><h1>Reçus</h1><p>Retrouve les ventes enregistrées dans cette boutique.</p></div></div>
      {error && <p className="catalog-error" role="alert">{error}</p>}
      {loading ? <div className="shop-feedback" role="status"><span className="loading-spinner" aria-hidden="true" /><div><strong>Chargement des reçus</strong><p>Récupération de l’historique...</p></div></div>
        : sales.length === 0 ? <div className="product-form-card"><h2>Aucune vente enregistrée</h2><p>Les reçus apparaîtront ici après la confirmation d’une vente.</p></div>
        : <div className="product-form-card stock-receipts-list">
            {sales.map((sale) => <article className="stock-receipt-row" key={sale.id}>
              <div><strong>{sale.receipt_number}</strong><span>{new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short", timeZone: shop?.timezone || "Africa/Lubumbashi" }).format(new Date(sale.created_at))}</span></div>
              <div><strong>{formatMoney(Number(sale.total_amount), shop?.currency_code || "CDF")}</strong><span>Paiement en espèces</span></div>
            </article>)}
          </div>}
    </section>
  );
}


type StockVariantRow = {
  id: string; product_id: string; sku: string; barcode: string | null;
  size: string | null; color: string | null; stock_quantity: number;
  low_stock_threshold: number; is_active: boolean;
  products?: { name: string } | null;
};
type StockMovementRow = {
  id: string; variant_id: string; movement_type: string; quantity_change: number;
  reason: string | null; created_at: string; created_by: string | null;
};
type ReceivedItemRow = {
  item_id: string;
  barcode: string;
  barcode_source: "supplier" | "stockwise";
  supplier_barcode: string | null;
  stock_movement_id: string;
};

function StockModule({ shop, user }: { shop: Shop | null; user: User }) {
  const [variants, setVariants] = useState<StockVariantRow[]>([]);
  const [movements, setMovements] = useState<StockMovementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [movementType, setMovementType] = useState<"in" | "out">("out");
  const [movementKind, setMovementKind] = useState<"opening" | "purchase" | "supplier_return" | "loss" | "adjustment">("loss");
  const [variantId, setVariantId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [reason, setReason] = useState("");
  const [search, setSearch] = useState("");
  const [productPage, setProductPage] = useState(1);
  const productPageSize = 10;
  const [historySearch, setHistorySearch] = useState("");
  const [historyType, setHistoryType] = useState("all");
  const [historyFrom, setHistoryFrom] = useState("");
  const [historyTo, setHistoryTo] = useState("");
  const [historyPage, setHistoryPage] = useState(1);
  const historyPageSize = 10;
  const [countVariantId, setCountVariantId] = useState("");
  const [countedQuantity, setCountedQuantity] = useState("");
  const [countReason, setCountReason] = useState("Comptage physique");
  const [countSaving, setCountSaving] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const [showReceiptForm, setShowReceiptForm] = useState(true);
  const [receiptVariantId, setReceiptVariantId] = useState("");
  const [receiptQuantity, setReceiptQuantity] = useState("1");
  const [receiptStep, setReceiptStep] = useState<1 | 2 | 3>(1);
  const [receiptExpectedByVariant, setReceiptExpectedByVariant] = useState<Record<string, number>>({});
  const [receiptBarcodes, setReceiptBarcodes] = useState("");
  const [receiptDraftItems, setReceiptDraftItems] = useState<Array<{ key: string; variantId: string; barcode: string | null }>>([]);
  const [receiptReason, setReceiptReason] = useState("Réception fournisseur");
  const [receiptSaving, setReceiptSaving] = useState(false);
  const [receivedItems, setReceivedItems] = useState<ReceivedItemRow[]>([]);
  const [activeStockTab, setActiveStockTab] = useState<"receipt" | "inventory" | "operations">("receipt");
  const [receiptScanMessage, setReceiptScanMessage] = useState("");

  async function handleReceiptScannedCode(codeValue: string) {
    const code = codeValue.trim();
    if (!code || !shop) return;
    setError(""); setReceiptScanMessage("");
    try {
      // An individual item barcode must never be received twice.
      const { data: existingItem, error: itemLookupError } = await supabase.from("variant_items")
        .select("id, barcode, status, product_variants(sku, size, color, products(name))")
        .eq("shop_id", shop.id).eq("barcode", code).maybeSingle();
      if (itemLookupError) throw new Error(itemLookupError.message);
      if (existingItem) {
        const details = existingItem as unknown as { status: string; product_variants?: { products?: { name?: string } | null } | null };
        setReceiptScanMessage(`Code déjà enregistré pour « ${details.product_variants?.products?.name ?? "un article"} » (${details.status}). Il n’a pas été ajouté.`);
        return;
      }
      if (receiptDraftItems.some((item) => item.barcode === code)) {
        setReceiptScanMessage("Ce code figure déjà dans la liste de réception. Il n’a pas été ajouté une deuxième fois."); return;
      }
      // A barcode attached to the variant is a model code, not a unique item code.
      const { data: matchingVariant, error: variantLookupError } = await supabase.from("product_variants")
        .select("id, sku, size, color, barcode, products(name)").eq("shop_id", shop.id).eq("barcode", code).eq("is_active", true).maybeSingle();
      if (variantLookupError) throw new Error(variantLookupError.message);
      if (matchingVariant) {
        const match = matchingVariant as unknown as { id: string; size: string | null; color: string | null; products?: { name: string } | null };
        setReceiptVariantId(match.id);
        setReceiptScanMessage(`Code du modèle reconnu pour « ${match.products?.name ?? "Produit" } ». Il ne sera pas réutilisé comme code individuel. Ajoute la pièce manuellement ou scanne son code individuel.`);
        return;
      }
      if (!receiptVariantId) {
        setReceiptBarcodes(code);
        setReceiptScanMessage(`Code fournisseur ${code} détecté. Sélectionne d’abord la variante, puis clique sur « Ajouter la pièce scannée ».`);
        return;
      }
      setReceiptDraftItems((items) => [...items, { key: `${Date.now()}-${Math.random()}`, variantId: receiptVariantId, barcode: code }]);
      setReceiptBarcodes("");
      setReceiptScanMessage(`Article ajouté à la liste (${receiptDraftItems.length + 1}). Scanne le suivant ou ajoute une pièce manuellement.`);
    } catch (lookupError) {
      setError(`Recherche du code impossible : ${lookupError instanceof Error ? lookupError.message : "erreur inconnue"}`);
    }
  }

  function addManualReceiptItem() {
    if (!receiptVariantId) { setError("Choisis la variante avant d’ajouter une pièce manuellement."); return; }
    const typed = receiptBarcodes.trim();
    if (typed && receiptDraftItems.some((item) => item.barcode === typed)) { setError("Ce code est déjà dans la liste."); return; }
    if (typed) {
      void handleReceiptScannedCode(typed);
      return;
    }
    setReceiptDraftItems((items) => [...items, { key: `${Date.now()}-${Math.random()}`, variantId: receiptVariantId, barcode: null }]);
    setError("");
  }

  async function loadStock() {
    if (!shop) { setVariants([]); setMovements([]); setLoading(false); return; }
    setLoading(true);
    setError("");
    try {
      const [variantResult, movementResult] = await Promise.all([
        supabase.from("product_variants")
          .select("id, product_id, sku, barcode, size, color, stock_quantity, low_stock_threshold, is_active, products(name)")
          .eq("shop_id", shop.id).eq("is_active", true).order("created_at", { ascending: false }),
        supabase.from("stock_movements")
          .select("id, variant_id, movement_type, quantity_change, reason, created_at, created_by")
          .eq("shop_id", shop.id).order("created_at", { ascending: false }).limit(50),
      ]);
      if (variantResult.error) throw new Error(`Impossible de charger les articles : ${variantResult.error.message}`);
      if (movementResult.error) throw new Error(`Impossible de charger l’historique : ${movementResult.error.message}`);
      setVariants((variantResult.data ?? []) as unknown as StockVariantRow[]);
      setMovements((movementResult.data ?? []) as StockMovementRow[]);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Impossible de charger le stock.");
    } finally { setLoading(false); }
  }

  useEffect(() => { void loadStock(); }, [shop?.id]);

  const selectedVariant = variants.find((variant) => variant.id === variantId) ?? null;
  const filteredVariants = variants.filter((variant) => {
    const query = search.trim().toLocaleLowerCase();
    return !query || `${variant.products?.name ?? ""} ${variant.sku} ${variant.barcode ?? ""} ${variant.size ?? ""} ${variant.color ?? ""}`.toLocaleLowerCase().includes(query);
  });
  const productPageCount = Math.max(1, Math.ceil(filteredVariants.length / productPageSize));
  const paginatedVariants = filteredVariants.slice((productPage - 1) * productPageSize, productPage * productPageSize);
  const variantById = new Map(variants.map((variant) => [variant.id, variant]));
  const movementLabels: Record<string, string> = {
    opening: "Stock initial", purchase: "Réapprovisionnement", sale: "Vente",
    sale_return: "Retour client", supplier_return: "Retour au fournisseur",
    loss: "Perte", adjustment: "Ajustement",
  };
  const historyDateKey = (value: string) => {
    const date = new Date(value);
    const parts = new Intl.DateTimeFormat("en-CA", {
      year: "numeric", month: "2-digit", day: "2-digit",
      timeZone: shop?.timezone || "Africa/Lubumbashi",
    }).formatToParts(date);
    const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
    return `${part("year")}-${part("month")}-${part("day")}`;
  };
  const filteredMovements = movements.filter((movement) => {
    const variant = variantById.get(movement.variant_id);
    const dateKey = historyDateKey(movement.created_at);
    const query = historySearch.trim().toLocaleLowerCase();
    const searchable = `${variant?.products?.name ?? ""} ${variant?.sku ?? ""} ${movementLabels[movement.movement_type] ?? movement.movement_type} ${movement.reason ?? ""} ${movement.quantity_change}`.toLocaleLowerCase();
    return (historyType === "all" || movement.movement_type === historyType)
      && (!historyFrom || dateKey >= historyFrom)
      && (!historyTo || dateKey <= historyTo)
      && (!query || searchable.includes(query));
  });
  const historyPageCount = Math.max(1, Math.ceil(filteredMovements.length / historyPageSize));
  const paginatedMovements = filteredMovements.slice(
    (historyPage - 1) * historyPageSize,
    historyPage * historyPageSize,
  );

  useEffect(() => {
    setProductPage(1);
  }, [search]);

  useEffect(() => {
    if (productPage > productPageCount) setProductPage(productPageCount);
  }, [productPage, productPageCount]);

  useEffect(() => {
    setHistoryPage(1);
  }, [historySearch, historyType, historyFrom, historyTo]);

  useEffect(() => {
    if (historyPage > historyPageCount) setHistoryPage(historyPageCount);
  }, [historyPage, historyPageCount]);

  async function handleReceiveItems(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!shop) { setError("La boutique n’est pas disponible."); return; }
    if (receiptDraftItems.length === 0) { setError("Ajoute ou scanne au moins une pièce avant de valider. La quantité seule ne crée plus d’articles automatiquement."); return; }
    const expectedEntries = Object.entries(receiptExpectedByVariant);
    if (expectedEntries.length === 0) { setError("Ajoute au moins une variante à la réception."); return; }
    for (const [expectedVariantId, expectedCount] of expectedEntries) {
      const actualCount = receiptDraftItems.filter((item) => item.variantId === expectedVariantId).length;
      if (actualCount !== expectedCount) {
        const v = variants.find((variant) => variant.id === expectedVariantId);
        setError(`${v?.products?.name ?? "Variante"}${v?.size ? ` · ${v.size}` : ""}${v?.color ? ` · ${v.color}` : ""} : ${expectedCount} pièce(s) attendue(s), ${actualCount} ajoutée(s). Complète la liste ou corrige la quantité.`);
        setReceiptStep(2);
        setReceiptVariantId(expectedVariantId);
        setReceiptQuantity(String(expectedCount));
        return;
      }
    }
    setReceiptSaving(true); setError(""); setFeedback(""); setReceivedItems([]);
    try {
      // Group only at submission because the existing RPC accepts one variant per call.
      const groups = new Map<string, Array<{ supplier_barcode: string | null }>>();
      for (const item of receiptDraftItems) {
        const rows = groups.get(item.variantId) ?? [];
        rows.push({ supplier_barcode: item.barcode }); groups.set(item.variantId, rows);
      }
      const allResults: ReceivedItemRow[] = [];
      for (const [groupVariantId, items] of groups) {
        const { data, error: rpcError } = await supabase.rpc("receive_variant_items", {
          p_shop_id: shop.id, p_variant_id: groupVariantId, p_items: items,
          p_reason: receiptReason.trim() || "Réception de marchandises",
        });
        if (rpcError) throw new Error(`Réception non enregistrée : ${rpcError.message}`);
        const result = (data ?? []) as ReceivedItemRow[];
        if (result.length !== items.length) throw new Error("La réception a été envoyée, mais la liste des codes reçus est incomplète. Actualise le stock avant de réessayer.");
        allResults.push(...result.map((item) => ({ ...item, _variantId: groupVariantId } as ReceivedItemRow)));
      }
      setReceivedItems(allResults);
      setFeedback(`Réception enregistrée : ${allResults.length} pièce(s) répartie(s) sur ${groups.size} variante(s). Le stock a été mis à jour.`);
      setReceiptQuantity("1"); setReceiptBarcodes(""); setReceiptDraftItems([]);
      setReceiptExpectedByVariant({}); setReceiptStep(1); setReceiptVariantId("");
      await loadStock();
    } catch (receiveError) {
      setError(receiveError instanceof Error ? receiveError.message : "Une erreur est survenue pendant la réception.");
    } finally { setReceiptSaving(false); }
  }

  async function handleInventoryCount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!shop) { setError("La boutique n’est pas disponible."); return; }
    const counted = Number(countedQuantity);
    const countVariant = variants.find((variant) => variant.id === countVariantId) ?? null;
    if (!countVariant) { setError("Choisis un produit à compter."); return; }
    if (!Number.isInteger(counted) || counted < 0) { setError("La quantité comptée doit être un nombre entier égal ou supérieur à zéro."); return; }
    const difference = counted - countVariant.stock_quantity;
    if (difference === 0) { setError("Aucun écart : la quantité comptée correspond déjà au stock enregistré."); return; }

    setCountSaving(true); setError(""); setFeedback("");
    try {
      const { error: rpcError } = await supabase.rpc("reconcile_stock_count", {
        p_shop_id: shop.id,
        p_variant_id: countVariant.id,
        p_counted_quantity: counted,
        p_reason: countReason.trim() || "Comptage physique",
        p_created_by: user.id,
      });
      if (rpcError) throw new Error(`La correction d’inventaire n’a pas été enregistrée : ${rpcError.message}`);
      setFeedback(`Inventaire corrigé : ${countVariant.products?.name ?? "Produit"}, écart de ${difference > 0 ? "+" : ""}${difference} unité(s).`);
      setCountedQuantity("");
      await loadStock();
    } catch (countError) {
      setError(countError instanceof Error ? countError.message : "Une erreur est survenue pendant la correction d’inventaire.");
    } finally { setCountSaving(false); }
  }

  async function handleMovement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!shop) { setError("La boutique n’est pas disponible."); return; }
    const parsedQuantity = Number(quantity);
    if (!variantId) { setError("Choisis un produit avant d’enregistrer le mouvement."); return; }
    if (!Number.isInteger(parsedQuantity) || parsedQuantity <= 0) { setError("La quantité doit être un nombre entier supérieur à zéro."); return; }
    if (movementType === "out" && selectedVariant && parsedQuantity > selectedVariant.stock_quantity) {
      setError(`Stock insuffisant. Quantité disponible : ${selectedVariant.stock_quantity}.`); return;
    }
    setSaving(true); setError(""); setFeedback("");
    try {
      const { error: rpcError } = await supabase.rpc("record_stock_movement", {
        p_shop_id: shop.id, p_variant_id: variantId, p_movement_type: movementKind,
        p_quantity: parsedQuantity, p_reason: reason.trim() || null, p_created_by: user.id,
      });
      if (rpcError) {
        const message = rpcError.message.toLowerCase().includes("insufficient stock")
          ? "Stock insuffisant : la quantité disponible ne permet pas cette sortie."
          : rpcError.message;
        throw new Error(`Le mouvement n’a pas été enregistré : ${message}`);
      }
      const movementLabel: Record<typeof movementKind, string> = {
        opening: "Stock initial",
        purchase: "Réapprovisionnement",
        supplier_return: "Retour au fournisseur",
        loss: "Perte",
        adjustment: "Correction d’inventaire",
      };
      setFeedback(`Mouvement « ${movementLabel[movementKind]} » enregistré : ${parsedQuantity} unité(s).`);
      setQuantity("1"); setReason("");
      await loadStock();
    } catch (movementError) {
      setError(movementError instanceof Error ? movementError.message : "Une erreur est survenue.");
    } finally { setSaving(false); }
  }

  return (
    <section className="catalog-page stock-page">
      <style>{`@media print {
        body * { visibility: hidden !important; }
        #stockwise-received-labels, #stockwise-received-labels * { visibility: visible !important; }
        #stockwise-received-labels { position: absolute; left: 0; top: 0; width: 100%; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8mm; }
        .stock-received-label { break-inside: avoid; border: 1px solid #333; padding: 5mm; color: #000 !important; background: #fff !important; min-height: 35mm; }
        .stock-received-label code { display: block; font-size: 9pt; margin: 3px 0 0; overflow-wrap: anywhere; }
        .stock-barcode-graphic { display: block; width: 100%; max-width: 58mm; height: 13mm; margin: 4px auto 2px; }
        .stock-label-variant { display: flex; justify-content: center; gap: 5px; font-size: 9pt; margin-top: 3px; }
        .stock-receipt-wizard-progress { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:10px; margin:18px 0 22px; }
        .stock-receipt-wizard-step { display:flex; align-items:center; gap:9px; padding:10px; border:1px solid var(--border, #dce8e0); border-radius:12px; color:var(--muted, #64748b); }
        .stock-receipt-wizard-step > span { display:grid; place-items:center; width:28px; height:28px; border-radius:50%; background:#eef3ef; font-weight:700; flex-shrink:0; }
        .stock-receipt-wizard-step.is-active { border-color:#168052; background:#f2faf5; color:#126b45; }
        .stock-receipt-wizard-step.is-complete > span { background:#168052; color:white; }
        .stock-receipt-wizard-step small { font-size:12px; font-weight:600; }
        .stock-receipt-wizard-panel { border:1px solid #e1ebe4; border-radius:14px; padding:20px; margin-bottom:16px; }
        .stock-receipt-wizard-panel h3 { margin:0 0 8px; }
        .stock-receipt-wizard-panel > p { color:#64748b; margin:0 0 18px; }
        .stock-receipt-progress-count { display:flex; align-items:baseline; gap:10px; padding:14px; background:#f2faf5; border-radius:10px; margin:12px 0 18px; }
        .stock-receipt-progress-count strong { font-size:24px; color:#147a4d; }
        .stock-receipt-progress-count span { color:#64748b; font-size:13px; }
        @media (max-width: 640px) { .stock-receipt-wizard-progress { gap:5px; } .stock-receipt-wizard-step { flex-direction:column; align-items:flex-start; padding:8px; gap:5px; } .stock-receipt-wizard-step small { font-size:10px; } .stock-receipt-wizard-panel { padding:14px; } }
        .stock-received-label > span { display: block; font-size: 8pt; }
        @page { margin: 8mm; }
      }`}</style>
      <div className="catalog-heading">
        <div><span className="section-eyebrow">MOUVEMENTS D’INVENTAIRE</span><h1>Gestion du stock</h1><p>Enregistre les articles reçus ou retirés et consulte les quantités disponibles.</p></div>
        <button className="secondary-button stock-refresh-button" type="button" onClick={() => void loadStock()} disabled={loading || saving}>Actualiser</button>
      </div>
      {feedback && <div className="catalog-notice" role="status">{feedback}<button type="button" onClick={() => setFeedback("")} aria-label="Fermer">×</button></div>}
      {error && <p className="catalog-error" role="alert">{error}</p>}

      <div className="stock-summary-grid">
        <article className="stock-summary-card"><span className="stock-summary-icon stock-summary-icon-green"><Icon name="stock" size={20} /></span><span>Références actives</span><strong>{loading ? "—" : variants.length}</strong></article>
        <article className="stock-summary-card"><span className="stock-summary-icon stock-summary-icon-blue"><Icon name="products" size={20} /></span><span>Unités en stock</span><strong>{loading ? "—" : variants.reduce((sum, variant) => sum + variant.stock_quantity, 0).toLocaleString("fr-FR")}</strong></article>
        <article className="stock-summary-card"><span className="stock-summary-icon stock-summary-icon-amber"><Icon name="alert" size={20} /></span><span>Stocks bas</span><strong>{loading ? "—" : variants.filter((variant) => variant.stock_quantity <= variant.low_stock_threshold).length}</strong></article>
      </div>

      <div className="stock-tabs" role="tablist" aria-label="Sections de gestion du stock">
        <button type="button" role="tab" aria-selected={activeStockTab === "receipt"} className={`stock-tab${activeStockTab === "receipt" ? " stock-tab-active" : ""}`} onClick={() => setActiveStockTab("receipt")}><Icon name="products" size={17} /> Réception</button>
        <button type="button" role="tab" aria-selected={activeStockTab === "inventory"} className={`stock-tab${activeStockTab === "inventory" ? " stock-tab-active" : ""}`} onClick={() => setActiveStockTab("inventory")}><Icon name="stock" size={17} /> Inventaire</button>
        <button type="button" role="tab" aria-selected={activeStockTab === "operations"} className={`stock-tab${activeStockTab === "operations" ? " stock-tab-active" : ""}`} onClick={() => setActiveStockTab("operations")}><Icon name="scanner" size={17} /> Autres opérations</button>
      </div>

      {activeStockTab === "receipt" && <>
      <section className="product-form-card stock-receipt-card">
        <div className="product-form-heading">
          <div>
            <span className="section-eyebrow">NOUVELLE FONCTIONNALITÉ</span>
            <h2>Réceptionner des articles</h2>
            <p>Ajoute chaque pièce en la scannant ou manuellement. Les codes StockWise sont générés uniquement pour les pièces sans code fournisseur individuel.</p>
          </div>
          <button className="secondary-button" type="button" onClick={() => setShowReceiptForm((value) => !value)}>
            {showReceiptForm ? "Réduire" : "Nouvelle réception"}
          </button>
        </div>
        {showReceiptForm && <form onSubmit={handleReceiveItems}>
          <div className="stock-receipt-wizard-progress" aria-label={`Étape ${receiptStep} sur 3`}>
            {["Choisir la variante", "Ajouter les pièces", "Vérifier"].map((label, index) => <div key={label} className={`stock-receipt-wizard-step${receiptStep === index + 1 ? " is-active" : ""}${receiptStep > index + 1 ? " is-complete" : ""}`}><span>{receiptStep > index + 1 ? "✓" : index + 1}</span><small>{label}</small></div>)}
          </div>
          {receiptStep === 1 && <div className="stock-receipt-wizard-panel">
            <h3>1. Quelle variante reçois-tu ?</h3>
            <p>Choisis un produit, sa taille et sa couleur, puis indique combien de pièces tu attends pour cette variante.</p>
            <div className="product-form-grid stock-movement-grid">
              <label>Produit / taille / couleur *
                <select value={receiptVariantId} onChange={(event) => { setReceiptVariantId(event.target.value); setReceiptQuantity(String(receiptExpectedByVariant[event.target.value] ?? 1)); setError(""); }} required>
                  <option value="">Choisir une variante</option>
                  {variants.map((variant) => <option key={variant.id} value={variant.id}>{variant.products?.name ?? "Produit sans nom"}{variant.size ? ` · ${variant.size}` : ""}{variant.color ? ` · ${variant.color}` : ""} — {variant.sku} (stock : {variant.stock_quantity})</option>)}
                </select>
              </label>
              <label>Nombre de pièces attendu *
                <input type="number" min="1" max="500" step="1" inputMode="numeric" value={receiptQuantity} onChange={(event) => setReceiptQuantity(event.target.value)} required />
              </label>
              <label className="stock-receipt-reason">Note de réception
                <input value={receiptReason} onChange={(event) => setReceiptReason(event.target.value)} maxLength={250} placeholder="Ex. Livraison fournisseur" />
              </label>
            </div>
            <div className="product-form-actions"><button className="primary-button" type="button" disabled={!receiptVariantId || !Number.isInteger(Number(receiptQuantity)) || Number(receiptQuantity) < 1 || Number(receiptQuantity) > 500} onClick={() => { setReceiptExpectedByVariant((previous) => ({ ...previous, [receiptVariantId]: Number(receiptQuantity) })); setReceiptBarcodes(""); setReceiptScanMessage(""); setError(""); setReceiptStep(2); }}>Continuer →</button></div>
          </div>}
          {receiptStep === 2 && <div className="stock-receipt-wizard-panel">
            <h3>2. Ajoute les pièces</h3>
            <p>{(() => { const v = variants.find((variant) => variant.id === receiptVariantId); return `${v?.products?.name ?? "Produit"}${v?.size ? ` · ${v.size}` : ""}${v?.color ? ` · ${v.color}` : ""}`; })()} · Objectif : {receiptExpectedByVariant[receiptVariantId] ?? Number(receiptQuantity)} pièce(s)</p>
            <div className="stock-receipt-progress-count"><strong>{receiptDraftItems.filter((item) => item.variantId === receiptVariantId).length} / {receiptExpectedByVariant[receiptVariantId] ?? Number(receiptQuantity)}</strong><span>pièces ajoutées pour cette variante</span></div>
            <PhoneScanConnector shop={shop} title="Réception · variante sélectionnée" onBarcode={handleReceiptScannedCode} />
            <label className="stock-receipt-codes">Code-barres individuel (facultatif)
              <input value={receiptBarcodes} onChange={(event) => { setReceiptBarcodes(event.target.value); setReceiptScanMessage(""); }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addManualReceiptItem(); } }} autoComplete="off" placeholder="Saisir ou scanner un code individuel" />
              <small>Chaque code scanné doit identifier une seule pièce. Si l’article n’a pas de code individuel, laisse ce champ vide.</small>
            </label>
            <div className="stock-receipt-scanner-actions">
              <button className="secondary-button" type="button" onClick={addManualReceiptItem} disabled={receiptSaving}>＋ {receiptBarcodes.trim() ? "Ajouter ce code" : "Ajouter sans code-barres"}</button>
            </div>
            {receiptScanMessage && <p className="stock-receipt-scan-message" role="status">{receiptScanMessage}</p>}
            <small>Les codes déjà enregistrés sont refusés. Les codes StockWise seront générés seulement pour les pièces ajoutées sans code individuel.</small>
            {receiptDraftItems.filter((item) => item.variantId === receiptVariantId).length > 0 && <div className="stock-receipt-draft-list"><strong>Pièces de cette variante</strong>{receiptDraftItems.filter((item) => item.variantId === receiptVariantId).map((item, index) => <div key={item.key}><span>{index + 1}. {item.barcode ?? "Code StockWise à générer"}</span><button type="button" className="secondary-button" onClick={() => setReceiptDraftItems((items) => items.filter((row) => row.key !== item.key))}>Retirer</button></div>)}</div>}
            <div className="product-form-actions"><button className="secondary-button" type="button" onClick={() => { setReceiptStep(1); setError(""); }}>← Changer la variante</button><button className="primary-button" type="button" onClick={() => { const expected = receiptExpectedByVariant[receiptVariantId] ?? Number(receiptQuantity); const actual = receiptDraftItems.filter((item) => item.variantId === receiptVariantId).length; if (actual !== expected) { setError(`Il faut ajouter ${expected - actual} pièce(s) supplémentaire(s) pour cette variante.`); return; } setError(""); setReceiptStep(3); }}>Terminer cette variante →</button></div>
          </div>}
          {receiptStep === 3 && <div className="stock-receipt-wizard-panel">
            <h3>3. Vérifie la réception</h3>
            <p>Voici le résumé des variantes et des pièces que tu as ajoutées. Tu peux ajouter une autre variante avant de valider.</p>
            <div className="stock-receipt-draft-list">{Object.entries(receiptExpectedByVariant).map(([id, expected]) => { const v = variants.find((variant) => variant.id === id); const actual = receiptDraftItems.filter((item) => item.variantId === id).length; return <div key={id}><span><strong>{v?.products?.name ?? "Produit"}{v?.size ? ` · ${v.size}` : ""}{v?.color ? ` · ${v.color}` : ""}</strong><small>{actual} / {expected} pièce(s) · {actual === expected ? "Complet" : "À compléter"}</small></span><button className="secondary-button" type="button" onClick={() => { setReceiptVariantId(id); setReceiptQuantity(String(expected)); setReceiptStep(2); setError(""); }}>Modifier</button></div>; })}</div>
            <p><strong>Total : {receiptDraftItems.length} pièce(s)</strong> sur {Object.values(receiptExpectedByVariant).reduce((sum, count) => sum + count, 0)} attendue(s).</p>
            <div className="product-form-actions"><button className="secondary-button" type="button" onClick={() => { setReceiptVariantId(""); setReceiptQuantity("1"); setReceiptBarcodes(""); setReceiptScanMessage(""); setError(""); setReceiptStep(1); }}>＋ Ajouter une autre variante</button><button className="primary-button" type="submit" disabled={receiptSaving || loading || !shop || receiptDraftItems.length === 0}>{receiptSaving ? "Réception en cours..." : "Valider la réception"}</button></div>
          </div>}
          <div className="product-form-actions"><button className="secondary-button" type="button" onClick={() => { setReceiptVariantId(""); setReceiptQuantity("1"); setReceiptBarcodes(""); setReceiptDraftItems([]); setReceiptExpectedByVariant({}); setReceiptStep(1); setReceiptReason("Réception fournisseur"); setReceiptScanMessage(""); setError(""); }}>Réinitialiser</button></div>
        </form>}
      </section>

      {receivedItems.length > 0 && <section className="product-form-card stock-received-labels">
        <div className="product-form-heading"><div><h2>Pièces réceptionnées</h2><p>{receivedItems.length} pièce(s) réceptionnée(s). Tu peux conserver cette liste ou l’imprimer.</p></div><button className="secondary-button" type="button" onClick={() => window.print()}>Imprimer la liste</button></div>
        <div className="stock-received-label-grid" id="stockwise-received-labels">
          {receivedItems.map((item, index) => {
            const labelVariant = variants.find((variant) => variant.id === (item as ReceivedItemRow & { _variantId?: string })._variantId) ?? variants.find((variant) => variant.id === receiptVariantId);
            return <article className="stock-received-label" key={item.item_id}>
              <span>{shop?.name ?? "STOCKWISE"} · {index + 1}/{receivedItems.length}</span>
              <strong>{labelVariant?.products?.name ?? "Article"}</strong>
              <div className="stock-label-variant">{labelVariant?.size && <span>Taille : {labelVariant.size}</span>}{labelVariant?.color && <span>Couleur : {labelVariant.color}</span>}</div>
              <BarcodeGraphic value={item.barcode} />
              <code>{item.barcode}</code>
              <small>{item.barcode_source === "supplier" ? "Code fournisseur" : "Code StockWise"}</small>
            </article>;
          })}
        </div>
        <p className="stock-count-help">Les étiquettes utilisent le format CODE128. Fais un essai d’impression et de scan avant de produire un grand lot.</p>
      </section>}

      </>}

      {activeStockTab === "operations" && <form className="product-form-card stock-movement-form" onSubmit={handleMovement}>
        <div className="product-form-heading"><div><h2>Enregistrer une sortie de stock</h2><p>Utilise cette section uniquement pour les articles retirés du stock. Les nouveaux articles doivent passer par Réception.</p></div></div>
        <div className="stock-type-switch" role="group" aria-label="Type de mouvement">
          <button type="button" className="stock-type-button stock-type-button-active stock-type-out" aria-pressed="true">− Sortie de stock</button>
        </div>
        <div className="product-form-grid stock-movement-grid">
          <label>Produit / référence *
            <select value={variantId} onChange={(event) => setVariantId(event.target.value)} required><option value="">Choisir un produit</option>
              {variants.map((variant) => <option key={variant.id} value={variant.id}>{variant.products?.name ?? "Produit sans nom"}{variant.size ? ` · ${variant.size}` : ""}{variant.color ? ` · ${variant.color}` : ""} — {variant.sku} (stock : {variant.stock_quantity})</option>)}
            </select>
          </label>
          <label>Motif de sortie *
            <select value={movementKind} onChange={(event) => setMovementKind(event.target.value as typeof movementKind)} required>
              <option value="loss">Perte / article endommagé</option>
              <option value="supplier_return">Retour au fournisseur</option>
              <option value="adjustment">Correction d’inventaire (sortie)</option>
            </select>
          </label>
          <label>Quantité *<input type="number" min="1" step="1" inputMode="numeric" value={quantity} onChange={(event) => setQuantity(event.target.value)} required /></label>
          <label>Note (facultatif)<input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={250} placeholder={movementKind === "loss" ? "Ex. Article endommagé" : movementKind === "supplier_return" ? "Ex. Retour commande fournisseur" : "Ex. Écart constaté au comptage"} /></label>
        </div>
        {selectedVariant && <p className="stock-selected-note">Stock actuel : <strong>{selectedVariant.stock_quantity}</strong> unité(s) · Après sortie : {Math.max(0, selectedVariant.stock_quantity - (Number(quantity) || 0))}</p>}
        {variants.length === 0 && !loading && <p className="stock-selected-note">Aucun produit actif disponible. Crée d’abord un produit dans le catalogue.</p>}
        <div className="product-form-actions"><button className="secondary-button" type="button" onClick={() => { setVariantId(""); setQuantity("1"); setReason(""); setMovementType("out"); setMovementKind("loss"); setError(""); }}>Réinitialiser</button><button className="primary-button" type="submit" disabled={saving || loading || !shop || variants.length === 0}>{saving ? "Enregistrement..." : "Enregistrer la sortie"}</button></div>
      </form>}

      {activeStockTab === "inventory" && <form className="product-form-card stock-count-form" onSubmit={handleInventoryCount}>
        <div className="product-form-heading"><div><h2>Correction d’inventaire</h2><p>Compare le stock enregistré avec la quantité réellement comptée dans la boutique.</p></div></div>
        <div className="product-form-grid stock-count-grid">
          <label>Produit / référence *
            <select value={countVariantId} onChange={(event) => { setCountVariantId(event.target.value); setCountedQuantity(""); setError(""); }} required>
              <option value="">Choisir un produit</option>
              {variants.map((variant) => <option key={variant.id} value={variant.id}>{variant.products?.name ?? "Produit sans nom"}{variant.size ? ` · ${variant.size}` : ""}{variant.color ? ` · ${variant.color}` : ""} — {variant.sku} (stock : {variant.stock_quantity})</option>)}
            </select>
          </label>
          <label>Quantité réellement comptée *<input type="number" min="0" step="1" inputMode="numeric" value={countedQuantity} onChange={(event) => setCountedQuantity(event.target.value)} placeholder="Ex. 160" required /></label>
          <label>Motif de la correction *<input value={countReason} onChange={(event) => setCountReason(event.target.value)} maxLength={250} required placeholder="Ex. Comptage physique" /></label>
        </div>
        {(() => {
          const countVariant = variants.find((variant) => variant.id === countVariantId);
          const counted = countedQuantity.trim() === "" ? null : Number(countedQuantity);
          const difference = countVariant && counted !== null && Number.isInteger(counted) && counted >= 0 ? counted - countVariant.stock_quantity : null;
          return countVariant ? <div className="stock-count-preview"><span>Stock enregistré : <strong>{countVariant.stock_quantity}</strong></span><span>Stock compté : <strong>{counted !== null && Number.isInteger(counted) && counted >= 0 ? counted : "—"}</strong></span><span className={difference === null || difference === 0 ? "" : difference > 0 ? "stock-count-positive" : "stock-count-negative"}>Écart : <strong>{difference === null ? "—" : `${difference > 0 ? "+" : ""}${difference}`}</strong></span></div> : <p className="stock-selected-note">Sélectionne un produit pour calculer l’écart.</p>;
        })()}
        <p className="stock-count-help">La correction sera enregistrée dans l’historique comme un ajustement. Un écart positif augmente le stock ; un écart négatif le diminue.</p>
        <div className="product-form-actions"><button className="secondary-button" type="button" onClick={() => { setCountVariantId(""); setCountedQuantity(""); setCountReason("Comptage physique"); setError(""); }}>Réinitialiser</button><button className="primary-button" type="submit" disabled={countSaving || loading || !shop || !countVariantId || countedQuantity.trim() === ""}>{countSaving ? "Correction..." : "Valider la correction"}</button></div>
      </form>}

      <div className="catalog-toolbar"><label className="catalog-search"><Icon name="products" size={18} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Rechercher un produit ou une référence..." /></label><span className="catalog-count">{filteredVariants.length} référence(s)</span></div>
      <div className="catalog-table-card">
        {loading ? <div className="catalog-empty"><span className="loading-spinner" /><p>Chargement du stock...</p></div> : filteredVariants.length === 0 ? <div className="catalog-empty"><h2>Aucune référence trouvée</h2><p>Crée un produit ou modifie ta recherche.</p></div> : (
          <div className="catalog-table-wrap"><table className="catalog-table"><thead><tr><th>Produit</th><th>Référence</th><th>Stock actuel</th><th>Seuil d’alerte</th><th>État</th></tr></thead><tbody>
            {paginatedVariants.map((variant) => { const low = variant.stock_quantity <= variant.low_stock_threshold; return <tr key={variant.id}><td><div className="catalog-product-name"><strong>{variant.products?.name ?? "Produit sans nom"}</strong><span>{[variant.size, variant.color].filter(Boolean).join(" · ") || "Aucune variante détaillée"}</span></div></td><td><code>{variant.sku}</code></td><td><span className={`stock-pill${variant.stock_quantity > 0 ? " stock-pill-in" : ""}`}>{variant.stock_quantity}</span></td><td>{variant.low_stock_threshold}</td><td><span className={`stock-status-pill${low ? " stock-status-low" : " stock-status-ok"}`}>{low ? "Stock bas" : "Disponible"}</span></td></tr>; })}
          </tbody></table></div>
        )}
        {!loading && filteredVariants.length > 0 && (
          <div className="stock-history-pagination stock-products-pagination" aria-label="Pagination des références de stock">
            <span>
              Affichage de {(productPage - 1) * productPageSize + 1} à {Math.min(productPage * productPageSize, filteredVariants.length)} sur {filteredVariants.length} référence(s)
            </span>
            <div className="stock-history-pagination-actions">
              <button type="button" className="secondary-button" onClick={() => setProductPage((page) => Math.max(1, page - 1))} disabled={productPage <= 1}>Précédent</button>
              <span>Page {productPage} / {productPageCount}</span>
              <button type="button" className="secondary-button" onClick={() => setProductPage((page) => Math.min(productPageCount, page + 1))} disabled={productPage >= productPageCount}>Suivant</button>
            </div>
          </div>
        )}
      </div>

      <div className="stock-history-section"><div className="stock-history-heading"><div><h2>Historique récent</h2><p>Les 50 derniers mouvements enregistrés.</p></div><span>{filteredMovements.length} sur {movements.length} mouvement(s)</span></div>
        <div className="stock-history-filters">
          <label className="stock-history-search">Rechercher<input value={historySearch} onChange={(event) => setHistorySearch(event.target.value)} placeholder="Produit, référence, type ou note..." /></label>
          <label>Type de mouvement<select value={historyType} onChange={(event) => setHistoryType(event.target.value)}><option value="all">Tous les types</option><option value="opening">Stock initial</option><option value="purchase">Réapprovisionnement</option><option value="sale">Vente</option><option value="sale_return">Retour client</option><option value="supplier_return">Retour au fournisseur</option><option value="loss">Perte</option><option value="adjustment">Ajustement</option></select></label>
          <label>Du<input type="date" value={historyFrom} max={historyTo || undefined} onChange={(event) => setHistoryFrom(event.target.value)} /></label>
          <label>Au<input type="date" value={historyTo} min={historyFrom || undefined} onChange={(event) => setHistoryTo(event.target.value)} /></label>
          <button className="secondary-button stock-history-reset" type="button" onClick={() => { setHistorySearch(""); setHistoryType("all"); setHistoryFrom(""); setHistoryTo(""); }}>Effacer les filtres</button>
        </div>
        <div className="catalog-table-card">
          {loading ? <div className="catalog-empty"><p>Chargement de l’historique...</p></div> : movements.length === 0 ? <div className="catalog-empty"><h2>Aucun mouvement pour le moment</h2><p>Les entrées et sorties apparaîtront ici après leur enregistrement.</p></div> : filteredMovements.length === 0 ? <div className="catalog-empty"><h2>Aucun résultat</h2><p>Modifie les critères ou efface les filtres pour revoir l’historique.</p></div> : (
            <div className="catalog-table-wrap"><table className="catalog-table"><thead><tr><th>Date</th><th>Produit</th><th>Type</th><th>Quantité</th><th>Motif</th></tr></thead><tbody>
              {paginatedMovements.map((movement) => { const variant = variantById.get(movement.variant_id); const isIn = movement.quantity_change > 0; return <tr key={movement.id}><td>{new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short", timeZone: shop?.timezone || "Africa/Lubumbashi" }).format(new Date(movement.created_at))}</td><td><div className="catalog-product-name"><strong>{variant?.products?.name ?? "Produit"}</strong><span>{variant?.sku ?? "Référence indisponible"}</span></div></td><td><span className={`stock-status-pill ${isIn ? "stock-status-ok" : "stock-status-out"}`}>{movementLabels[movement.movement_type] ?? (isIn ? "Entrée" : "Sortie")}</span></td><td className={isIn ? "stock-quantity-positive" : "stock-quantity-negative"}>{isIn ? "+" : ""}{movement.quantity_change}</td><td>{movement.reason || "—"}</td></tr>; })}
            </tbody></table></div>
          )}
          {!loading && filteredMovements.length > 0 && (
            <div className="stock-history-pagination" aria-label="Pagination de l’historique">
              <span>
                Affichage de {(historyPage - 1) * historyPageSize + 1} à {Math.min(historyPage * historyPageSize, filteredMovements.length)} sur {filteredMovements.length} mouvement(s)
              </span>
              <div className="stock-history-pagination-actions">
                <button type="button" className="secondary-button" onClick={() => setHistoryPage((page) => Math.max(1, page - 1))} disabled={historyPage <= 1}>Précédent</button>
                <span>Page {historyPage} / {historyPageCount}</span>
                <button type="button" className="secondary-button" onClick={() => setHistoryPage((page) => Math.min(historyPageCount, page + 1))} disabled={historyPage >= historyPageCount}>Suivant</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

type IconName =
  | "dashboard"
  | "products"
  | "scanner"
  | "stock"
  | "sales"
  | "receipts"
  | "store"
  | "logout"
  | "chevron-right"
  | "calendar"
  | "wallet"
  | "clock"
  | "shield"
  | "alert"
  | "scan"
  | "smartphone";

function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true as const,
  };

  const paths: Record<IconName, ReactNode> = {
    dashboard: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
      </>
    ),
    products: (
      <>
        <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" />
        <path d="m4.5 7.7 7.5 4.4 7.5-4.4M12 12.1V21" />
      </>
    ),
    scanner: (
      <>
        <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" />
        <path d="M7 10v4m3-5v6m3-6v6m3-5v4" />
      </>
    ),
    stock: (
      <>
        <path d="M4 7h16M4 17h16M7 4l-3 3 3 3M17 14l3 3-3 3" />
      </>
    ),
    sales: (
      <>
        <path d="M4 4h16v16H4z" />
        <path d="M8 8h8M8 12h8M8 16h5" />
      </>
    ),
    receipts: (
      <>
        <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" />
        <path d="M9 8h6M9 12h6M9 16h4" />
      </>
    ),
    store: (
      <>
        <path d="M3 10h18l-1.5-6h-15L3 10Z" />
        <path d="M5 10v10h14V10M9 20v-6h6v6" />
      </>
    ),
    logout: (
      <>
        <path d="M10 17l5-5-5-5M15 12H3" />
        <path d="M12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6" />
      </>
    ),
    "chevron-right": <path d="m9 18 6-6-6-6" />,
    calendar: (
      <>
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M16 3v4M8 3v4M3 10h18" />
      </>
    ),
    wallet: (
      <>
        <rect x="3" y="5" width="18" height="15" rx="2" />
        <path d="M3 9h18M16 14h2" />
      </>
    ),
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    shield: (
      <>
        <path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z" />
        <path d="m9 12 2 2 4-4" />
      </>
    ),
    alert: (
      <>
        <path d="M12 3 2.8 19a1.3 1.3 0 0 0 1.1 2h16.2a1.3 1.3 0 0 0 1.1-2L12 3Z" />
        <path d="M12 9v4m0 3h.01" />
      </>
    ),
    scan: (
      <>
        <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" />
        <path d="M7 12h10" />
      </>
    ),
    smartphone: (
      <>
        <rect x="6" y="2" width="12" height="20" rx="2" />
        <path d="M11 18h2" />
      </>
    ),
  };

  return <svg {...common}>{paths[name]}</svg>;
}

function Brand({ light = false }: { light?: boolean }) {
  return (
    <div className={`brand-lockup${light ? " brand-lockup-light" : ""}`}>
      <span className="brand-mark" aria-hidden="true">
        S
      </span>
      <span className="brand-name">StockWise</span>
    </div>
  );
}

export default App;
