import { Fragment, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import JsBarcode from "jsbarcode";
import { BrowserMultiFormatReader } from "@zxing/browser";
import type { User } from "@supabase/supabase-js";
import { supabase } from "./lib/supabase";
import boutiqueImage from "./assets/stockwise-boutique.png";
import "./App.StockWise.Grouped.css";
import "./App.StockWise.Stock.css";

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
  const [activeModule, setActiveModule] = useState<"dashboard" | "products" | "stock" | "scanner">(
    "dashboard",
  );

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
      { label: "Ventes", icon: "sales" as const, active: false },
      { label: "Reçus", icon: "receipts" as const, active: false },
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
                disabled={!("module" in item)}
                onClick={() => {
                  if ("module" in item && item.module) {
                    setActiveModule(item.module);
                  }
                }}
                aria-current={item.active ? "page" : undefined}
                title={
                  !("module" in item)
                    ? "Ce module sera disponible dans une prochaine étape"
                    : undefined
                }
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
                {activeModule === "products" ? "Produits" : activeModule === "stock" ? "Gestion du stock" : activeModule === "scanner" ? "Scanner" : "Vue d'ensemble"}
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
                        <div className="metric-topline">
                          <span className="metric-icon metric-icon-green">
                            <Icon name="products" size={20} />
                          </span>
                          <span className="metric-placeholder">
                            À configurer
                          </span>
                        </div>
                        <p>Produits enregistrés</p>
                        <div className="metric-value">—</div>
                        <span className="metric-footnote">
                          Après la création du catalogue
                        </span>
                      </article>
                      <article className="metric-card">
                        <div className="metric-topline">
                          <span className="metric-icon metric-icon-blue">
                            <Icon name="sales" size={20} />
                          </span>
                          <span className="metric-placeholder">
                            À configurer
                          </span>
                        </div>
                        <p>Ventes du jour</p>
                        <div className="metric-value">—</div>
                        <span className="metric-footnote">
                          Après l'activation des ventes
                        </span>
                      </article>
                      <article className="metric-card">
                        <div className="metric-topline">
                          <span className="metric-icon metric-icon-amber">
                            <Icon name="stock" size={20} />
                          </span>
                          <span className="metric-placeholder">
                            À configurer
                          </span>
                        </div>
                        <p>Alertes de stock bas</p>
                        <div className="metric-value">—</div>
                        <span className="metric-footnote">
                          Suivi dès que le stock sera activé
                        </span>
                      </article>
                      <article className="metric-card">
                        <div className="metric-topline">
                          <span className="metric-icon metric-icon-purple">
                            <Icon name="wallet" size={20} />
                          </span>
                          <span className="metric-placeholder">
                            À configurer
                          </span>
                        </div>
                        <p>Valeur du stock</p>
                        <div className="metric-value">
                          — <small>{shop?.currency_code ?? "CDF"}</small>
                        </div>
                        <span className="metric-footnote">
                          Calculée à partir des produits réels
                        </span>
                      </article>
                    </section>

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
                          <span className="setup-progress">0 sur 3</span>
                        </div>

                        <div className="setup-steps">
                          <div className="setup-step">
                            <span className="step-number">1</span>
                            <div className="step-copy">
                              <strong>Créer votre catalogue</strong>
                              <span>
                                Ajoutez vos articles, leurs prix, tailles et
                                couleurs.
                              </span>
                            </div>
                            <span className="step-state">À venir</span>
                          </div>
                          <div className="setup-step">
                            <span className="step-number">2</span>
                            <div className="step-copy">
                              <strong>Organiser le stock</strong>
                              <span>
                                Enregistrez les quantités disponibles en
                                boutique.
                              </span>
                            </div>
                            <span className="step-state">À venir</span>
                          </div>
                          <div className="setup-step">
                            <span className="step-number">3</span>
                            <div className="step-copy">
                              <strong>Enregistrer vos premières ventes</strong>
                              <span>
                                Préparez le scanner et les reçus numériques.
                              </span>
                            </div>
                            <span className="step-state">À venir</span>
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
                          BIENTÔT SUR STOCKWISE
                        </span>
                        <h2>Le stock, en un scan.</h2>
                        <p>
                          Votre téléphone pourra servir à scanner les
                          codes-barres pour retrouver un article et préparer les
                          opérations de stock.
                        </p>
                        <div className="quickstart-note">
                          <Icon name="smartphone" size={17} />
                          <span>Conçu pour fonctionner aussi sur iPhone.</span>
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
  product_variants?: {
    sku: string;
    size: string | null;
    color: string | null;
    products?: { name: string } | null;
  } | null;
};

function ScannerModule({ shop }: { shop: Shop | null }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scannerControlsRef = useRef<{ stop: () => void } | null>(null);
  const [scanning, setScanning] = useState(false);
  const [manualCode, setManualCode] = useState("");
  const [item, setItem] = useState<ScannedVariant | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [searching, setSearching] = useState(false);

  useEffect(() => () => {
    try { scannerControlsRef.current?.stop(); } catch { /* camera may already be stopped */ }
    scannerControlsRef.current = null;
  }, []);

  async function findItem(codeValue: string) {
    const code = codeValue.trim();
    if (!code || !shop) return;
    setManualCode(code); setError(""); setMessage(""); setItem(null); setSearching(true);
    try {
      const { data, error: queryError } = await supabase
        .from("variant_items")
        .select("id, barcode, barcode_source, supplier_barcode, status, variant_id, product_variants(sku, size, color, products(name))")
        .eq("shop_id", shop.id)
        .eq("barcode", code)
        .maybeSingle();
      if (queryError) throw new Error(queryError.message);
      if (!data) {
        setMessage("Aucune pièce trouvée pour ce code dans cette boutique.");
        return;
      }
      setItem(data as unknown as ScannedVariant);
      setMessage("Pièce retrouvée dans StockWise.");
    } catch (lookupError) {
      setError(`Impossible de rechercher ce code : ${lookupError instanceof Error ? lookupError.message : "erreur inconnue"}`);
    } finally { setSearching(false); }
  }

  async function startCamera() {
    setError(""); setMessage(""); setItem(null);
    if (!shop) { setError("La boutique n’est pas disponible."); return; }
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("La caméra nécessite un navigateur compatible et une connexion HTTPS. Ouvre StockWise avec son URL sécurisée sur ton téléphone.");
      return;
    }
    try {
      const reader = new BrowserMultiFormatReader();
      setScanning(true);
      const controls = await reader.decodeFromVideoDevice(undefined, videoRef.current!, (result, scanError) => {
        if (result) {
          const code = result.getText();
          try { scannerControlsRef.current?.stop(); } catch { /* no-op */ }
          scannerControlsRef.current = null;
          setScanning(false);
          void findItem(code);
        }
        // Les erreurs de décodage sans code sont normales pendant le scan.
        void scanError;
      });
      scannerControlsRef.current = controls;
      if (!videoRef.current || !videoRef.current.isConnected) {
        controls.stop();
        scannerControlsRef.current = null;
        setScanning(false);
      }
    } catch (cameraError) {
      setScanning(false);
      setError(cameraError instanceof Error ? cameraError.message : "Impossible d’ouvrir la caméra. Vérifie les autorisations du navigateur.");
    }
  }

  function stopCamera() {
    try { scannerControlsRef.current?.stop(); } catch { /* no-op */ }
    scannerControlsRef.current = null;
    setScanning(false);
  }

  const statusLabel: Record<string, string> = {
    available: "Disponible",
    sold: "Vendu",
    return_pending_inspection: "Retour à inspecter",
    damaged: "Endommagé",
  };

  return (
    <section className="catalog-page stock-scan-page">
      <div className="catalog-heading">
        <div><span className="section-eyebrow">LECTURE PAR CAMÉRA</span><h1>Scanner un article</h1><p>Utilise la caméra de ton téléphone pour retrouver un article par son code-barres.</p></div>
      </div>
      {!shop && <p className="catalog-error" role="alert">La boutique n’est pas disponible.</p>}
      {error && <p className="catalog-error" role="alert">{error}</p>}
      {message && <div className="catalog-notice" role="status">{message}</div>}
      <div className="product-form-card stock-scan-card">
        <div className="product-form-heading"><div><h2>Scanner avec la caméra</h2><p>Place le code-barres CODE128 dans le cadre et garde le téléphone stable.</p></div></div>
        <div className="stock-scan-video-wrap">
          <video ref={videoRef} className="stock-scan-video" muted playsInline aria-label="Aperçu de la caméra pour scanner un code-barres" />
          {!scanning && <div className="stock-scan-placeholder"><Icon name="scan" size={36} /><span>La caméra est arrêtée</span></div>}
          {scanning && <div className="stock-scan-frame" aria-hidden="true" />}
        </div>
        <div className="product-form-actions stock-scan-actions">
          {!scanning ? <button className="primary-button" type="button" onClick={() => void startCamera()} disabled={!shop || searching}><Icon name="scan" size={17} /> Démarrer le scan</button> : <button className="secondary-button" type="button" onClick={stopCamera}>Arrêter la caméra</button>}
        </div>
        <p className="stock-scan-help">La caméra fonctionne généralement uniquement sur HTTPS (ou localhost). Autorise l’accès à la caméra lorsque le navigateur le demande.</p>
      </div>
      <form className="product-form-card stock-scan-manual" onSubmit={(event) => { event.preventDefault(); void findItem(manualCode); }}>
        <div className="product-form-heading"><div><h2>Recherche manuelle</h2><p>Tu peux aussi coller ou saisir le code-barres si la caméra ne le lit pas.</p></div></div>
        <div className="product-form-grid stock-scan-manual-grid"><label>Code-barres *<input value={manualCode} onChange={(event) => setManualCode(event.target.value)} placeholder="Ex. SW-..." autoComplete="off" required /></label><div className="product-form-actions"><button className="primary-button" type="submit" disabled={!shop || searching}>{searching ? "Recherche..." : "Rechercher la pièce"}</button></div></div>
      </form>
      {item && <article className="product-form-card stock-scan-result"><div className="product-form-heading"><div><h2>Pièce identifiée</h2><p>Résultat de la recherche dans l’inventaire individuel.</p></div></div><div className="stock-scan-result-grid"><div><span>Produit</span><strong>{item.product_variants?.products?.name ?? "Produit sans nom"}</strong></div><div><span>Taille</span><strong>{item.product_variants?.size ?? "—"}</strong></div><div><span>Couleur</span><strong>{item.product_variants?.color ?? "—"}</strong></div><div><span>Référence</span><strong>{item.product_variants?.sku ?? "—"}</strong></div><div><span>Code individuel</span><code>{item.barcode}</code></div><div><span>Statut</span><strong className={`stock-scan-status stock-scan-status-${item.status}`}>{statusLabel[item.status] ?? item.status}</strong></div></div></article>}
      <p className="stock-scan-security"><Icon name="shield" size={16} /> La recherche est limitée à la boutique connectée. Le scan ne modifie pas le stock.</p>
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
  const [movementType, setMovementType] = useState<"in" | "out">("in");
  const [movementKind, setMovementKind] = useState<"opening" | "purchase" | "supplier_return" | "loss" | "adjustment">("purchase");
  const [variantId, setVariantId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [reason, setReason] = useState("");
  const [search, setSearch] = useState("");
  const [historySearch, setHistorySearch] = useState("");
  const [historyType, setHistoryType] = useState("all");
  const [historyFrom, setHistoryFrom] = useState("");
  const [historyTo, setHistoryTo] = useState("");
  const [countVariantId, setCountVariantId] = useState("");
  const [countedQuantity, setCountedQuantity] = useState("");
  const [countReason, setCountReason] = useState("Comptage physique");
  const [countSaving, setCountSaving] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const [showReceiptForm, setShowReceiptForm] = useState(true);
  const [receiptVariantId, setReceiptVariantId] = useState("");
  const [receiptQuantity, setReceiptQuantity] = useState("1");
  const [receiptBarcodes, setReceiptBarcodes] = useState("");
  const [receiptReason, setReceiptReason] = useState("Réception fournisseur");
  const [receiptSaving, setReceiptSaving] = useState(false);
  const [receivedItems, setReceivedItems] = useState<ReceivedItemRow[]>([]);
  const [activeStockTab, setActiveStockTab] = useState<"receipt" | "inventory" | "operations">("receipt");
  const receiptVideoRef = useRef<HTMLVideoElement | null>(null);
  const receiptScannerControlsRef = useRef<{ stop: () => void } | null>(null);
  const [receiptScanning, setReceiptScanning] = useState(false);
  const [receiptScanMessage, setReceiptScanMessage] = useState("");

  useEffect(() => () => {
    try { receiptScannerControlsRef.current?.stop(); } catch { /* caméra déjà arrêtée */ }
    receiptScannerControlsRef.current = null;
  }, []);

  async function handleReceiptScannedCode(codeValue: string) {
    const code = codeValue.trim();
    if (!code || !shop) return;
    setError("");
    setReceiptScanMessage("");
    try {
      // First, prevent receiving the same individually registered piece twice.
      const { data: existingItem, error: itemLookupError } = await supabase
        .from("variant_items")
        .select("id, barcode, status, product_variants(sku, size, color, products(name))")
        .eq("shop_id", shop.id)
        .eq("barcode", code)
        .maybeSingle();
      if (itemLookupError) throw new Error(itemLookupError.message);
      if (existingItem) {
        const details = existingItem as unknown as {
          barcode: string; status: string;
          product_variants?: { sku?: string; size?: string | null; color?: string | null; products?: { name?: string } | null } | null;
        };
        setReceiptScanMessage(`Ce code est déjà enregistré pour « ${details.product_variants?.products?.name ?? "un article"} » (${details.status}). Aucune nouvelle pièce n’a été ajoutée.`);
        return;
      }

      // A variant-level barcode identifies the model/variant, not a unique physical piece.
      // Select that variant, but let the receive function generate individual StockWise codes.
      const { data: matchingVariant, error: variantLookupError } = await supabase
        .from("product_variants")
        .select("id, sku, size, color, barcode, products(name)")
        .eq("shop_id", shop.id)
        .eq("barcode", code)
        .eq("is_active", true)
        .maybeSingle();
      if (variantLookupError) throw new Error(variantLookupError.message);
      if (matchingVariant) {
        const match = matchingVariant as unknown as { id: string; sku: string; size: string | null; color: string | null; products?: { name: string } | null };
        setReceiptVariantId(match.id);
        setReceiptScanMessage(`Variante retrouvée : « ${match.products?.name ?? "Produit"} »${match.size ? ` · ${match.size}` : ""}${match.color ? ` · ${match.color}` : ""}. Le code du modèle n’est pas ajouté comme code individuel : StockWise générera un code unique pour chaque pièce reçue.`);
        return;
      }

      // Unknown supplier code: keep it ready, then let the user choose the matching
      // existing variant in the form. No product or database record is created by scanning.
      setReceiptBarcodes((current) => {
        const codes = current.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean);
        return codes.includes(code) ? current : (current.trim() ? `${current.trim()}\n${code}` : code);
      });
      setReceiptScanMessage(`Code inconnu dans StockWise : ${code}. Choisis la variante existante dans « Produit / taille / couleur ». Si c’est un nouveau produit, crée-le d’abord dans Produits, puis reviens ici pour la réception.`);
    } catch (lookupError) {
      setError(`Recherche du code impossible : ${lookupError instanceof Error ? lookupError.message : "erreur inconnue"}`);
    }
  }

  async function startReceiptCamera() {
    setError("");
    setReceiptScanMessage("");
    if (!shop) { setError("La boutique n’est pas disponible."); return; }
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("La caméra nécessite HTTPS. Ouvre StockWise avec son adresse sécurisée sur ton téléphone.");
      return;
    }
    try {
      const reader = new BrowserMultiFormatReader();
      setReceiptScanning(true);
      const controls = await reader.decodeFromVideoDevice(undefined, receiptVideoRef.current!, (result) => {
        if (!result) return;
        const code = result.getText().trim();
        if (!code) return;
        try { receiptScannerControlsRef.current?.stop(); } catch { /* no-op */ }
        receiptScannerControlsRef.current = null;
        setReceiptScanning(false);
        void handleReceiptScannedCode(code);
      });
      receiptScannerControlsRef.current = controls;
      if (!receiptVideoRef.current || !receiptVideoRef.current.isConnected) {
        controls.stop();
        receiptScannerControlsRef.current = null;
        setReceiptScanning(false);
      }
    } catch (cameraError) {
      setReceiptScanning(false);
      setError(cameraError instanceof Error ? cameraError.message : "Impossible d’ouvrir la caméra. Vérifie les autorisations du navigateur.");
    }
  }

  function stopReceiptCamera() {
    try { receiptScannerControlsRef.current?.stop(); } catch { /* no-op */ }
    receiptScannerControlsRef.current = null;
    setReceiptScanning(false);
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

  async function handleReceiveItems(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!shop) { setError("La boutique n’est pas disponible."); return; }
    const parsedQuantity = Number(receiptQuantity);
    if (!receiptVariantId) { setError("Choisis la variante à réceptionner."); return; }
    if (!Number.isInteger(parsedQuantity) || parsedQuantity < 1 || parsedQuantity > 500) {
      setError("La quantité doit être un nombre entier entre 1 et 500 par réception.");
      return;
    }
    const supplierCodes = receiptBarcodes
      .split(/\r?\n/)
      .map((code) => code.trim())
      .filter(Boolean);
    if (supplierCodes.length > parsedQuantity) {
      setError(`Tu as saisi ${supplierCodes.length} code(s), mais la quantité reçue est de ${parsedQuantity}.`);
      return;
    }
    setReceiptSaving(true); setError(""); setFeedback(""); setReceivedItems([]);
    try {
      const items = Array.from({ length: parsedQuantity }, (_, index) => ({
        supplier_barcode: supplierCodes[index] || null,
      }));
      const { data, error: rpcError } = await supabase.rpc("receive_variant_items", {
        p_shop_id: shop.id,
        p_variant_id: receiptVariantId,
        p_items: items,
        p_reason: receiptReason.trim() || "Réception de marchandises",
      });
      if (rpcError) throw new Error(`Réception non enregistrée : ${rpcError.message}`);
      const result = (data ?? []) as ReceivedItemRow[];
      if (result.length !== parsedQuantity) {
        throw new Error("La réception a été envoyée, mais la liste des codes reçus est incomplète. Actualise le stock avant de réessayer.");
      }
      setReceivedItems(result);
      const chosenVariant = variants.find((variant) => variant.id === receiptVariantId);
      setFeedback(`Réception enregistrée : ${result.length} pièce(s) pour « ${chosenVariant?.products?.name ?? "Produit"} ». Le stock a été mis à jour.`);
      setReceiptQuantity("1");
      setReceiptBarcodes("");
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
            <p>Une fiche de stock et un code-barres individuel seront créés pour chaque article reçu.</p>
          </div>
          <button className="secondary-button" type="button" onClick={() => setShowReceiptForm((value) => !value)}>
            {showReceiptForm ? "Réduire" : "Nouvelle réception"}
          </button>
        </div>
        {showReceiptForm && <form onSubmit={handleReceiveItems}>
          <div className="product-form-grid stock-movement-grid">
            <label>Produit / taille / couleur *
              <select value={receiptVariantId} onChange={(event) => setReceiptVariantId(event.target.value)} required>
                <option value="">Choisir une variante</option>
                {variants.map((variant) => <option key={variant.id} value={variant.id}>{variant.products?.name ?? "Produit sans nom"}{variant.size ? ` · ${variant.size}` : ""}{variant.color ? ` · ${variant.color}` : ""} — {variant.sku} (stock : {variant.stock_quantity})</option>)}
              </select>
            </label>
            <label>Quantité reçue *
              <input type="number" min="1" max="500" step="1" inputMode="numeric" value={receiptQuantity} onChange={(event) => setReceiptQuantity(event.target.value)} required />
            </label>
            <label className="stock-receipt-reason">Note de réception
              <input value={receiptReason} onChange={(event) => setReceiptReason(event.target.value)} maxLength={250} placeholder="Ex. Livraison fournisseur" />
            </label>
            <label className="stock-receipt-codes">Codes-barres fournisseur (facultatif)
              <textarea value={receiptBarcodes} onChange={(event) => { setReceiptBarcodes(event.target.value); setReceiptScanMessage(""); }} rows={4} autoComplete="off" placeholder={"Un code par ligne. Tu peux les saisir ou utiliser la caméra du téléphone.\nEx. 3601234567890"} />
              <small>À chaque scan, StockWise vérifie d’abord si le code correspond à une pièce déjà enregistrée ou à une variante existante. Les codes de modèle partagés ne sont pas réutilisés comme codes individuels ; StockWise génère alors des codes uniques par pièce.</small>
            </label>
            <div className="stock-receipt-phone-scanner">
              <div className="stock-receipt-scanner-actions">
                {!receiptScanning ? <button className="secondary-button" type="button" onClick={() => void startReceiptCamera()} disabled={!shop || receiptSaving}><Icon name="scan" size={17} /> Scanner avec mon téléphone</button> : <button className="secondary-button" type="button" onClick={stopReceiptCamera}>Arrêter le scanner</button>}
                {receiptScanMessage && <span className="stock-receipt-scan-message" role="status">{receiptScanMessage}</span>}
              </div>
              <div className="stock-receipt-camera-wrap" style={{ display: receiptScanning ? "block" : "none" }}><div className="stock-receipt-camera-preview"><video ref={receiptVideoRef} className="stock-scan-video" muted playsInline aria-label="Caméra pour scanner le code fournisseur" /><div className="stock-scan-frame" aria-hidden="true" /></div><p>Cadre un seul code-barres à la fois. Après la lecture, le code sera traité automatiquement.</p></div>
              <small>La caméra nécessite une connexion HTTPS et l’autorisation du navigateur. Le code lu est ajouté automatiquement au champ si c’est un code fournisseur inconnu. Pour scanner un autre article, relance le scanner.</small>
            </div>
          </div>
          <div className="product-form-actions">
            <button className="secondary-button" type="button" onClick={() => { setReceiptVariantId(""); setReceiptQuantity("1"); setReceiptBarcodes(""); setReceiptReason("Réception fournisseur"); setError(""); }}>Réinitialiser</button>
            <button className="primary-button" type="submit" disabled={receiptSaving || loading || !shop || variants.length === 0}>{receiptSaving ? "Réception en cours..." : "Valider la réception"}</button>
          </div>
        </form>}
      </section>

      {receivedItems.length > 0 && <section className="product-form-card stock-received-labels">
        <div className="product-form-heading"><div><h2>Pièces réceptionnées</h2><p>{receivedItems.length} code(s) individuel(s) créé(s). Tu peux conserver cette liste ou l’imprimer.</p></div><button className="secondary-button" type="button" onClick={() => window.print()}>Imprimer la liste</button></div>
        <div className="stock-received-label-grid" id="stockwise-received-labels">
          {receivedItems.map((item, index) => {
            const labelVariant = variants.find((variant) => variant.id === receiptVariantId);
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
        <div className="product-form-heading"><div><h2>Enregistrer un mouvement</h2><p>Le stock sera mis à jour automatiquement après validation.</p></div></div>
        <div className="stock-type-switch" role="group" aria-label="Type de mouvement">
          <button type="button" className={movementType === "in" ? "stock-type-button stock-type-button-active stock-type-in" : "stock-type-button"} onClick={() => { setMovementType("in"); setMovementKind("purchase"); setError(""); }}>＋ Entrée de stock</button>
          <button type="button" className={movementType === "out" ? "stock-type-button stock-type-button-active stock-type-out" : "stock-type-button"} onClick={() => { setMovementType("out"); setMovementKind("loss"); setError(""); }}>− Sortie de stock</button>
        </div>
        <div className="product-form-grid stock-movement-grid">
          <label>Produit / référence *
            <select value={variantId} onChange={(event) => setVariantId(event.target.value)} required><option value="">Choisir un produit</option>
              {variants.map((variant) => <option key={variant.id} value={variant.id}>{variant.products?.name ?? "Produit sans nom"}{variant.size ? ` · ${variant.size}` : ""}{variant.color ? ` · ${variant.color}` : ""} — {variant.sku} (stock : {variant.stock_quantity})</option>)}
            </select>
          </label>
          <label>Type de mouvement *
            <select value={movementKind} onChange={(event) => setMovementKind(event.target.value as typeof movementKind)} required>
              {movementType === "in" ? (
                <>
                  <option value="purchase">Réapprovisionnement</option>
                  <option value="opening">Stock initial</option>
                </>
              ) : (
                <>
                  <option value="loss">Perte / article endommagé</option>
                  <option value="supplier_return">Retour au fournisseur</option>
                  <option value="adjustment">Correction d’inventaire (sortie)</option>
                </>
              )}
            </select>
          </label>
          <label>Quantité *<input type="number" min="1" step="1" inputMode="numeric" value={quantity} onChange={(event) => setQuantity(event.target.value)} required /></label>
          <label>Note (facultatif)<input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={250} placeholder={movementType === "in" ? (movementKind === "opening" ? "Ex. Stock de départ" : "Ex. Réapprovisionnement fournisseur") : (movementKind === "loss" ? "Ex. Article endommagé" : movementKind === "supplier_return" ? "Ex. Retour commande fournisseur" : "Ex. Écart constaté au comptage")} /></label>
        </div>
        {selectedVariant && <p className="stock-selected-note">Stock actuel : <strong>{selectedVariant.stock_quantity}</strong> unité(s){movementType === "out" ? ` · Après sortie : ${Math.max(0, selectedVariant.stock_quantity - (Number(quantity) || 0))}` : ` · Après entrée : ${selectedVariant.stock_quantity + (Number(quantity) || 0)}`}</p>}
        {variants.length === 0 && !loading && <p className="stock-selected-note">Aucun produit actif disponible. Crée d’abord un produit dans le catalogue.</p>}
        <div className="product-form-actions"><button className="secondary-button" type="button" onClick={() => { setVariantId(""); setQuantity("1"); setReason(""); setMovementType("in"); setMovementKind("purchase"); setError(""); }}>Réinitialiser</button><button className="primary-button" type="submit" disabled={saving || loading || !shop || variants.length === 0}>{saving ? "Enregistrement..." : "Enregistrer le mouvement"}</button></div>
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
            {filteredVariants.map((variant) => { const low = variant.stock_quantity <= variant.low_stock_threshold; return <tr key={variant.id}><td><div className="catalog-product-name"><strong>{variant.products?.name ?? "Produit sans nom"}</strong><span>{[variant.size, variant.color].filter(Boolean).join(" · ") || "Aucune variante détaillée"}</span></div></td><td><code>{variant.sku}</code></td><td><span className={`stock-pill${variant.stock_quantity > 0 ? " stock-pill-in" : ""}`}>{variant.stock_quantity}</span></td><td>{variant.low_stock_threshold}</td><td><span className={`stock-status-pill${low ? " stock-status-low" : " stock-status-ok"}`}>{low ? "Stock bas" : "Disponible"}</span></td></tr>; })}
          </tbody></table></div>
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
              {filteredMovements.map((movement) => { const variant = variantById.get(movement.variant_id); const isIn = movement.quantity_change > 0; return <tr key={movement.id}><td>{new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short", timeZone: shop?.timezone || "Africa/Lubumbashi" }).format(new Date(movement.created_at))}</td><td><div className="catalog-product-name"><strong>{variant?.products?.name ?? "Produit"}</strong><span>{variant?.sku ?? "Référence indisponible"}</span></div></td><td><span className={`stock-status-pill ${isIn ? "stock-status-ok" : "stock-status-out"}`}>{movementLabels[movement.movement_type] ?? (isIn ? "Entrée" : "Sortie")}</span></td><td className={isIn ? "stock-quantity-positive" : "stock-quantity-negative"}>{isIn ? "+" : ""}{movement.quantity_change}</td><td>{movement.reason || "—"}</td></tr>; })}
            </tbody></table></div>
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
