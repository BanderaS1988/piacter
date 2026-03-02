// ============================================================
// PIACTÉR – TELJES SUPABASE BACKEND
// ============================================================
// TELEPÍTÉS:
// 1. Menj a https://supabase.com oldalra → New Project
// 2. Másold ki a Project URL-t és az anon key-t
// 3. Cseréld ki alul a SUPABASE_URL és SUPABASE_ANON_KEY értékeket
// 4. Futtasd le az SQL sémát a Supabase SQL Editorban
// 5. Másold be ezt a fájlt a HTML <script> tagek közé (a meglévő script elé)
// ============================================================

// ============================================================
// 1. SQL SÉMA – ezt futtasd le a Supabase SQL Editorban
// ============================================================
/*
-- FELHASZNÁLÓK (profiles)
CREATE TABLE profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  full_name TEXT,
  email TEXT,
  phone TEXT,
  location TEXT,
  zip TEXT,
  avatar_url TEXT,
  bio TEXT,
  is_verified BOOLEAN DEFAULT FALSE,
  is_banned BOOLEAN DEFAULT FALSE,
  loyalty_points INTEGER DEFAULT 0,
  loyalty_level TEXT DEFAULT 'bronze',
  referral_code TEXT UNIQUE,
  referred_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- KATEGÓRIÁK
CREATE TABLE categories (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  icon TEXT,
  parent_id INTEGER REFERENCES categories(id),
  listing_count INTEGER DEFAULT 0
);

-- HIRDETÉSEK
CREATE TABLE listings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  price INTEGER NOT NULL,
  negotiable BOOLEAN DEFAULT FALSE,
  condition TEXT CHECK (condition IN ('new','like_new','good','used','for_parts')) DEFAULT 'good',
  category_id INTEGER REFERENCES categories(id),
  location TEXT,
  zip TEXT,
  shipping TEXT DEFAULT 'both',
  shipping_cost INTEGER DEFAULT 0,
  payment_methods TEXT[] DEFAULT ARRAY['cash'],
  images TEXT[] DEFAULT ARRAY[]::TEXT[],
  status TEXT CHECK (status IN ('active','sold','expired','draft','banned')) DEFAULT 'active',
  boost_type TEXT CHECK (boost_type IN ('none','featured','premium','turbo')) DEFAULT 'none',
  boost_until TIMESTAMPTZ,
  views INTEGER DEFAULT 0,
  watchers INTEGER DEFAULT 0,
  is_auction BOOLEAN DEFAULT FALSE,
  auction_start_price INTEGER,
  auction_current_price INTEGER,
  auction_end_time TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '30 days'
);

-- AUKCIÓS LICITEK
CREATE TABLE auction_bids (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  listing_id UUID REFERENCES listings(id) ON DELETE CASCADE,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  is_auto BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ÜZENETEK (szálak)
CREATE TABLE message_threads (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  listing_id UUID REFERENCES listings(id) ON DELETE SET NULL,
  buyer_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  seller_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  last_message TEXT,
  last_message_at TIMESTAMPTZ DEFAULT NOW(),
  buyer_unread INTEGER DEFAULT 0,
  seller_unread INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ÜZENETEK
CREATE TABLE messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  thread_id UUID REFERENCES message_threads(id) ON DELETE CASCADE,
  sender_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  is_read BOOLEAN DEFAULT FALSE,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ÉRTÉKELÉSEK
CREATE TABLE reviews (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  reviewer_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  reviewed_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  listing_id UUID REFERENCES listings(id) ON DELETE SET NULL,
  rating INTEGER CHECK (rating BETWEEN 1 AND 5) NOT NULL,
  comment TEXT,
  type TEXT CHECK (type IN ('buyer','seller')) DEFAULT 'buyer',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(reviewer_id, listing_id)
);

-- KEDVENCEK
CREATE TABLE favorites (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  listing_id UUID REFERENCES listings(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, listing_id)
);

-- BEJELENTÉSEK
CREATE TABLE reports (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  reporter_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  listing_id UUID REFERENCES listings(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  details TEXT,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- FIZETÉSEK
CREATE TABLE payments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  listing_id UUID REFERENCES listings(id) ON DELETE SET NULL,
  buyer_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  seller_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  method TEXT NOT NULL,
  status TEXT CHECK (status IN ('pending','paid','refunded','failed')) DEFAULT 'pending',
  transaction_id TEXT,
  barion_payment_id TEXT,
  paypal_order_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- KIEMELÉSI RENDELÉSEK
CREATE TABLE boost_orders (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  listing_id UUID REFERENCES listings(id) ON DELETE CASCADE,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  boost_type TEXT NOT NULL,
  amount INTEGER NOT NULL,
  method TEXT,
  status TEXT DEFAULT 'pending',
  starts_at TIMESTAMPTZ DEFAULT NOW(),
  ends_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ÉRTESÍTÉSEK
CREATE TABLE notifications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT,
  message TEXT NOT NULL,
  data JSONB,
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- MENTETT KERESÉSEK
CREATE TABLE saved_searches (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  query TEXT,
  category_id INTEGER REFERENCES categories(id),
  min_price INTEGER,
  max_price INTEGER,
  location TEXT,
  notify_email BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- STATISZTIKA
CREATE TABLE listing_views (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  listing_id UUID REFERENCES listings(id) ON DELETE CASCADE,
  viewer_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  ip_hash TEXT,
  viewed_at TIMESTAMPTZ DEFAULT NOW()
);

-- AFFILIATE
CREATE TABLE referrals (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  referrer_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  referred_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'pending',
  reward_amount INTEGER DEFAULT 500,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE favorites ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_searches ENABLE ROW LEVEL SECURITY;
ALTER TABLE auction_bids ENABLE ROW LEVEL SECURITY;
ALTER TABLE boost_orders ENABLE ROW LEVEL SECURITY;

-- Profiles: mindenki láthat, csak saját módosítható
CREATE POLICY "Profiles are public" ON profiles FOR SELECT USING (true);
CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Users can insert own profile" ON profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- Listings: aktívak nyilvánosak, saját kezelhető
CREATE POLICY "Active listings are public" ON listings FOR SELECT USING (status = 'active' OR auth.uid() = user_id);
CREATE POLICY "Users can insert own listings" ON listings FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own listings" ON listings FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own listings" ON listings FOR DELETE USING (auth.uid() = user_id);

-- Messages: csak résztvevők láthatják
CREATE POLICY "Thread participants can view messages" ON messages FOR SELECT USING (
  EXISTS (SELECT 1 FROM message_threads mt WHERE mt.id = thread_id AND (mt.buyer_id = auth.uid() OR mt.seller_id = auth.uid()))
);
CREATE POLICY "Authenticated users can send messages" ON messages FOR INSERT WITH CHECK (auth.uid() = sender_id);

-- Favorites: csak saját
CREATE POLICY "Users manage own favorites" ON favorites FOR ALL USING (auth.uid() = user_id);

-- Reviews: mindenki láthat, csak saját küldhet
CREATE POLICY "Reviews are public" ON reviews FOR SELECT USING (true);
CREATE POLICY "Users can insert own reviews" ON reviews FOR INSERT WITH CHECK (auth.uid() = reviewer_id);

-- Notifications: csak saját
CREATE POLICY "Users see own notifications" ON notifications FOR ALL USING (auth.uid() = user_id);

-- Payments: csak érintett felek
CREATE POLICY "Payment parties can view" ON payments FOR SELECT USING (auth.uid() = buyer_id OR auth.uid() = seller_id);

-- ============================================================
-- FUNCTIONS & TRIGGERS
-- ============================================================

-- Auto profil létrehozás regisztrációkor
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, username, email, referral_code)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1)),
    NEW.email,
    upper(substring(gen_random_uuid()::text, 1, 8))
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Hirdetés megtekintés számlálás
CREATE OR REPLACE FUNCTION increment_listing_views(listing_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE listings SET views = views + 1 WHERE id = listing_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Értékelés átlag frissítés
CREATE OR REPLACE FUNCTION get_user_rating(user_id UUID)
RETURNS NUMERIC AS $$
  SELECT COALESCE(AVG(rating), 0) FROM reviews WHERE reviewed_id = user_id;
$$ LANGUAGE sql SECURITY DEFINER;

-- Hirdetés lejárat kezelés
CREATE OR REPLACE FUNCTION expire_old_listings()
RETURNS VOID AS $$
BEGIN
  UPDATE listings SET status = 'expired'
  WHERE status = 'active' AND expires_at < NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Kategória szám frissítés
CREATE OR REPLACE FUNCTION update_category_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE categories SET listing_count = (
    SELECT COUNT(*) FROM listings WHERE category_id = NEW.category_id AND status = 'active'
  ) WHERE id = NEW.category_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_cat_count AFTER INSERT OR UPDATE OR DELETE ON listings
FOR EACH ROW EXECUTE FUNCTION update_category_count();

-- Loyalty pontok hozzáadása
CREATE OR REPLACE FUNCTION add_loyalty_points(user_id UUID, points INTEGER, reason TEXT)
RETURNS VOID AS $$
DECLARE new_points INTEGER;
BEGIN
  UPDATE profiles SET loyalty_points = loyalty_points + points WHERE id = user_id
  RETURNING loyalty_points INTO new_points;
  -- Szint frissítés
  UPDATE profiles SET loyalty_level = CASE
    WHEN new_points >= 5000 THEN 'platinum'
    WHEN new_points >= 2000 THEN 'gold'
    WHEN new_points >= 500 THEN 'silver'
    ELSE 'bronze'
  END WHERE id = user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Alapkategóriák feltöltése
INSERT INTO categories (name, slug, icon) VALUES
('Elektronika', 'elektronika', '📱'),
('Ruha & Divat', 'ruha-divat', '👗'),
('Járművek', 'jarmu', '🚗'),
('Ingatlan', 'ingatlan', '🏠'),
('Sport & Szabadidő', 'sport', '⚽'),
('Ház & Kert', 'haz-kert', '🛋'),
('Könyvek & Játékok', 'konyvek', '📚'),
('Gyerek', 'gyerek', '🧸'),
('Állatoknak', 'allatok', '🐾'),
('Munka & Szolgáltatás', 'munka', '💼');

-- Alkategóriák
INSERT INTO categories (name, slug, icon, parent_id) VALUES
('Mobiltelefonok', 'mobil', '📱', 1),
('Laptopok', 'laptop', '💻', 1),
('Táblagépek', 'tablet', '📟', 1),
('TV & Hangszórók', 'tv', '📺', 1),
('Fényképezőgépek', 'fenykep', '📷', 1),
('Konzolok', 'konzol', '🎮', 1),
('Női ruházat', 'noi-ruha', '👗', 2),
('Férfi ruházat', 'ferfi-ruha', '👔', 2),
('Cipők', 'cipok', '👟', 2),
('Táskák', 'taskak', '👜', 2),
('Személyautók', 'szemelya', '🚗', 3),
('Motorkerékpárok', 'motor', '🏍️', 3),
('Kerékpárok', 'kerekpar', '🚲', 3),
('Eladó lakások', 'elado-lakas', '🏢', 4),
('Kiadó lakások', 'kiado-lakas', '🏘️', 4),
('Bútorok', 'butorok', '🛋', 6),
('Háztartási gépek', 'hzt-gepek', '🫙', 6);
*/

// ============================================================
// 2. SUPABASE CLIENT KONFIGURÁCIÓ
// ============================================================

const SUPABASE_URL = 'https://YOUR_PROJECT_ID.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR_ANON_KEY_HERE';

// Supabase CDN betöltése
(function loadSupabase() {
  const s = document.createElement('script');
  s.src = 'https://cdnjs.cloudflare.com/ajax/libs/supabase-js/2.39.0/supabase-js.min.js';
  s.onload = () => {
    window.sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true
      }
    });
    initSupabase();
  };
  document.head.appendChild(s);
})();

// ============================================================
// 3. INICIALIZÁLÁS
// ============================================================

async function initSupabase() {
  // Auth állapot figyelés
  sb.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_IN' && session) {
      window.currentUser = session.user;
      await loadCurrentUserProfile();
      updateUIForLoggedInUser();
      await loadListingsFromDB();
      await loadNotificationsFromDB();
    } else if (event === 'SIGNED_OUT') {
      window.currentUser = null;
      window.currentProfile = null;
      updateUIForLoggedOutUser();
      await loadListingsFromDB();
    }
  });

  // Meglévő session ellenőrzés
  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    window.currentUser = session.user;
    await loadCurrentUserProfile();
    updateUIForLoggedInUser();
  }

  // Hirdetések betöltése
  await loadListingsFromDB();

  // Realtime feliratkozások
  setupRealtimeSubscriptions();
}

// ============================================================
// 4. AUTHENTIKÁCIÓ
// ============================================================

async function doLogin() {
  const email = document.querySelector('#loginModal input[type="email"]').value;
  const password = document.querySelector('#loginModal input[type="password"]').value;

  if (!email || !password) { showToast('Töltsd ki az összes mezőt!', 'error'); return; }

  const { data, error } = await sb.auth.signInWithPassword({ email, password });

  if (error) {
    const msgs = {
      'Invalid login credentials': 'Hibás e-mail vagy jelszó!',
      'Email not confirmed': 'Erősítsd meg az e-mail címed!',
      'Too many requests': 'Túl sok próbálkozás. Várj egy kicsit!'
    };
    showToast(msgs[error.message] || error.message, 'error');
    return;
  }

  closeModal('loginModal');
  showToast('✅ Sikeres bejelentkezés! Üdv, ' + (data.user.email.split('@')[0]) + '!', 'success');
  launchConfetti();
}

async function doRegister() {
  const inputs = document.querySelectorAll('#registerModal input');
  const firstName = inputs[0].value, lastName = inputs[1].value;
  const username = inputs[2].value, email = inputs[3].value;
  const password = inputs[4].value, passwordConfirm = inputs[5].value;
  const phone = inputs[6].value;
  const termsAccepted = document.querySelector('#registerModal input[type="checkbox"]').checked;

  if (!firstName || !lastName || !username || !email || !password) {
    showToast('Töltsd ki az összes kötelező mezőt!', 'error'); return;
  }
  if (password !== passwordConfirm) {
    showToast('A jelszavak nem egyeznek!', 'error'); return;
  }
  if (password.length < 8) {
    showToast('A jelszó legalább 8 karakter legyen!', 'error'); return;
  }
  if (!termsAccepted) {
    showToast('El kell fogadnod az ÁSZF-et!', 'error'); return;
  }

  // Felhasználónév ellenőrzés
  const { data: existing } = await sb.from('profiles').select('username').eq('username', username).single();
  if (existing) { showToast('Ez a felhasználónév már foglalt!', 'error'); return; }

  const { data, error } = await sb.auth.signUp({
    email, password,
    options: {
      data: { username, full_name: lastName + ' ' + firstName, phone }
    }
  });

  if (error) { showToast(error.message, 'error'); return; }

  // Referral kezelés
  const urlParams = new URLSearchParams(window.location.search);
  const refCode = urlParams.get('ref');
  if (refCode) {
    const { data: referrer } = await sb.from('profiles').select('id').eq('referral_code', refCode).single();
    if (referrer) {
      await sb.from('referrals').insert({ referrer_id: referrer.id, referred_id: data.user.id });
      await sb.rpc('add_loyalty_points', { user_id: referrer.id, points: 100, reason: 'referral' });
    }
  }

  closeModal('registerModal');
  showToast('✅ Sikeres regisztráció! Ellenőrizd az e-mailed a megerősítéshez.', 'success');
}

async function signInWithGoogle() {
  const { error } = await sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin }
  });
  if (error) showToast(error.message, 'error');
}

async function signInWithFacebook() {
  const { error } = await sb.auth.signInWithOAuth({
    provider: 'facebook',
    options: { redirectTo: window.location.origin }
  });
  if (error) showToast(error.message, 'error');
}

async function doLogout() {
  await sb.auth.signOut();
  showToast('👋 Sikeres kijelentkezés!', 'info');
}

async function forgotPassword(email) {
  const { error } = await sb.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + '?reset=true'
  });
  if (error) showToast(error.message, 'error');
  else showToast('📧 Jelszó-visszaállító e-mail elküldve!', 'success');
}

// ============================================================
// 5. PROFIL KEZELÉS
// ============================================================

async function loadCurrentUserProfile() {
  if (!window.currentUser) return;
  const { data, error } = await sb.from('profiles').select('*').eq('id', currentUser.id).single();
  if (!error) {
    window.currentProfile = data;
    document.getElementById('profileName').textContent = data.full_name || data.username;
    document.getElementById('profileAvatar').textContent = (data.full_name || data.username).substring(0, 2).toUpperCase();
    if (data.loyalty_points) document.getElementById('loyaltyPoints').textContent = data.loyalty_points.toLocaleString('hu-HU');
  }
}

async function saveProfile() {
  if (!window.currentUser) { showModal('loginModal'); return; }
  const inputs = document.querySelectorAll('#pt-info .form-control');
  const updates = {
    full_name: inputs[1].value + ' ' + inputs[0].value,
    email: inputs[2].value,
    phone: inputs[3].value,
    location: inputs[4].value,
    updated_at: new Date().toISOString()
  };
  const { error } = await sb.from('profiles').update(updates).eq('id', currentUser.id);
  if (error) showToast(error.message, 'error');
  else { showToast('✅ Profil mentve!', 'success'); await loadCurrentUserProfile(); }
}

async function uploadAvatar(file) {
  if (!window.currentUser) return;
  const ext = file.name.split('.').pop();
  const path = `avatars/${currentUser.id}.${ext}`;
  const { error: uploadError } = await sb.storage.from('avatars').upload(path, file, { upsert: true });
  if (uploadError) { showToast(uploadError.message, 'error'); return; }
  const { data: { publicUrl } } = sb.storage.from('avatars').getPublicUrl(path);
  await sb.from('profiles').update({ avatar_url: publicUrl }).eq('id', currentUser.id);
  document.getElementById('profileAvatar').innerHTML = `<img src="${publicUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
  showToast('✅ Profilkép frissítve!', 'success');
  await sb.rpc('add_loyalty_points', { user_id: currentUser.id, points: 20, reason: 'avatar_upload' });
}

// ============================================================
// 6. HIRDETÉSEK
// ============================================================

async function loadListingsFromDB() {
  const { data, error } = await sb
    .from('listings')
    .select(`*, profiles(username, is_verified, loyalty_level), categories(name, icon)`)
    .eq('status', 'active')
    .order('boost_type', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) { console.error('Listings load error:', error); return; }

  if (data && data.length > 0) {
    // Konvertálás a frontend formátumra
    window.sampleListings = data.map(l => ({
      id: l.id,
      title: l.title,
      price: l.price,
      cat: l.categories?.name || 'Egyéb',
      loc: l.location || 'Ismeretlen',
      date: timeAgo(l.created_at),
      img: l.images?.[0] || '📦',
      condition: conditionLabel(l.condition),
      seller: l.profiles?.username || 'Ismeretlen',
      rating: 4.5,
      views: l.views,
      premium: l.boost_type === 'premium' || l.boost_type === 'turbo',
      featured: l.boost_type === 'featured',
      negotiable: l.negotiable,
      description: l.description,
      dbId: l.id
    }));
    window.currentListings = [...window.sampleListings];
    renderListings();
  }
}

async function submitListing() {
  if (!window.currentUser) { showModal('loginModal'); showToast('Bejelentkezés szükséges!', 'error'); return; }

  const title = document.getElementById('nl-title').value;
  const price = document.getElementById('nl-price').value;
  const cat = document.getElementById('nl-cat').value;
  const desc = document.getElementById('nl-desc').value;
  const loc = document.getElementById('nl-loc').value;
  const zip = document.getElementById('nl-zip').value;
  const condition = conditionValue(document.getElementById('nl-condition').value);
  const negotiable = document.getElementById('nl-negotiable').checked;
  const shipping = document.getElementById('nl-shipping').value;
  const shipCost = document.getElementById('nl-shipcost').value;

  if (!title || !price || !cat) { showToast('Tölts ki minden kötelező mezőt! ⚠️', 'error'); return; }

  // Képek feltöltése Supabase Storage-ba
  let imageUrls = [];
  for (const imgData of uploadedImgs) {
    const url = await uploadListingImage(imgData);
    if (url) imageUrls.push(url);
  }

  // Kategória ID keresés
  const { data: catData } = await sb.from('categories').select('id').ilike('name', `%${cat}%`).single();

  const { data, error } = await sb.from('listings').insert({
    user_id: currentUser.id,
    title, price: parseInt(price),
    description: desc,
    location: loc, zip,
    condition,
    negotiable,
    category_id: catData?.id,
    images: imageUrls,
    shipping,
    shipping_cost: parseInt(shipCost) || 0,
    status: 'active'
  }).select().single();

  if (error) { showToast(error.message, 'error'); return; }

  // Loyalty pont
  await sb.rpc('add_loyalty_points', { user_id: currentUser.id, points: 10, reason: 'listing_created' });

  closeModal('newListingModal');
  uploadedImgs = [];
  launchConfetti();
  showToast('🎉 Hirdetés sikeresen feladva!', 'success');
  await loadListingsFromDB();
}

async function uploadListingImage(dataUrl) {
  try {
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    const filename = `listings/${currentUser.id}/${Date.now()}.jpg`;
    const { error } = await sb.storage.from('listing-images').upload(filename, blob, { contentType: 'image/jpeg' });
    if (error) return null;
    const { data: { publicUrl } } = sb.storage.from('listing-images').getPublicUrl(filename);
    return publicUrl;
  } catch { return null; }
}

async function saveEditListing() {
  if (!window.currentUser || !editingId) return;
  const updates = {
    title: document.getElementById('edit-title').value,
    price: parseInt(document.getElementById('edit-price').value),
    condition: conditionValue(document.getElementById('edit-condition').value),
    location: document.getElementById('edit-loc').value,
    negotiable: document.getElementById('edit-negotiable').checked,
    status: document.getElementById('edit-sold').checked ? 'sold' : 'active',
    updated_at: new Date().toISOString()
  };
  const { error } = await sb.from('listings').update(updates).eq('id', editingId).eq('user_id', currentUser.id);
  if (error) showToast(error.message, 'error');
  else { closeModal('editListingModal'); showToast('✅ Hirdetés frissítve!', 'success'); await loadListingsFromDB(); }
}

async function deleteListing() {
  if (!confirm('Biztosan törlöd a hirdetést?')) return;
  const { error } = await sb.from('listings').delete().eq('id', editingId).eq('user_id', currentUser.id);
  if (error) showToast(error.message, 'error');
  else { closeModal('editListingModal'); showToast('🗑️ Hirdetés törölve', 'info'); await loadListingsFromDB(); }
}

async function incrementViews(listingId) {
  await sb.rpc('increment_listing_views', { listing_id: listingId });
}

// ============================================================
// 7. KEDVENCEK
// ============================================================

async function toggleWish(id, btn) {
  if (!window.currentUser) { showModal('loginModal'); showToast('Bejelentkezés szükséges!', 'error'); return; }

  if (wishlist.has(id)) {
    await sb.from('favorites').delete().eq('user_id', currentUser.id).eq('listing_id', id);
    wishlist.delete(id);
    btn.textContent = '🤍';
    showToast('Eltávolítva a kedvencekből', 'info');
  } else {
    await sb.from('favorites').insert({ user_id: currentUser.id, listing_id: id });
    wishlist.add(id);
    btn.textContent = '❤️';
    showToast('Hozzáadva a kedvencekhez! ❤️', 'success');
  }
}

async function loadFavoritesFromDB() {
  if (!window.currentUser) return;
  const { data } = await sb.from('favorites').select('listing_id').eq('user_id', currentUser.id);
  if (data) data.forEach(f => wishlist.add(f.listing_id));
}

// ============================================================
// 8. ÜZENETEK
// ============================================================

async function loadThreadsFromDB() {
  if (!window.currentUser) return;
  const { data } = await sb
    .from('message_threads')
    .select(`*, listings(title), buyer:profiles!buyer_id(username), seller:profiles!seller_id(username)`)
    .or(`buyer_id.eq.${currentUser.id},seller_id.eq.${currentUser.id}`)
    .order('last_message_at', { ascending: false });

  if (!data) return;
  const list = document.getElementById('msgList');
  if (!list) return;
  list.innerHTML = data.map((t, i) => {
    const other = t.buyer_id === currentUser.id ? t.seller?.username : t.buyer?.username;
    const unread = t.buyer_id === currentUser.id ? t.buyer_unread : t.seller_unread;
    return `<div class="msg-item ${unread > 0 ? 'unread' : ''}" onclick="openThreadChat('${t.id}','${other}')">
      <div class="avatar-sm">${(other||'?').substring(0,2).toUpperCase()}</div>
      <div class="msg-content">
        <div class="msg-from">${other || 'Ismeretlen'}</div>
        <div class="msg-preview">${t.last_message || '...'}</div>
      </div>
      <div class="msg-time">${timeAgo(t.last_message_at)}</div>
    </div>`;
  }).join('');
}

async function openThreadChat(threadId, otherUser) {
  document.getElementById('chatWith').textContent = otherUser;
  window.activeThreadId = threadId;

  const { data } = await sb.from('messages').select('*, profiles(username)').eq('thread_id', threadId).order('created_at');
  const chat = document.getElementById('chatMessages');
  if (!chat || !data) return;

  chat.innerHTML = data.map(m => {
    const isOwn = m.sender_id === currentUser?.id;
    const read = m.is_read ? '<span class="read-receipt">✓✓</span>' : '<span style="opacity:0.5;font-size:0.7rem">✓</span>';
    return `<div class="chat-msg ${isOwn ? 'own' : ''}">
      <div class="chat-bubble">${m.content}</div>
      <div style="font-size:0.7rem;color:var(--text2);margin-top:3px;${isOwn ? 'text-align:right' : ''}">${timeAgo(m.created_at)} ${isOwn ? read : ''}</div>
    </div>`;
  }).join('');
  chat.scrollTop = chat.scrollHeight;

  // Olvasottnak jelölés
  await sb.from('messages').update({ is_read: true, read_at: new Date().toISOString() })
    .eq('thread_id', threadId).neq('sender_id', currentUser?.id);
}

async function sendMsg() {
  const inp = document.getElementById('chatInput');
  const v = inp.value.trim();
  if (!v) return;
  if (!window.currentUser) { showModal('loginModal'); return; }

  if (window.activeThreadId) {
    const { error } = await sb.from('messages').insert({
      thread_id: activeThreadId,
      sender_id: currentUser.id,
      content: v
    });
    if (!error) {
      await sb.from('message_threads').update({ last_message: v, last_message_at: new Date().toISOString() }).eq('id', activeThreadId);
      const chat = document.getElementById('chatMessages');
      chat.innerHTML += `<div class="chat-msg own"><div class="chat-bubble">${v}</div><div style="font-size:0.7rem;color:var(--text2);margin-top:3px;text-align:right">Most <span style="opacity:0.5;font-size:0.7rem">✓</span></div></div>`;
      chat.scrollTop = chat.scrollHeight;
      setTimeout(async () => {
        await sb.from('messages').update({ is_read: true }).eq('thread_id', activeThreadId).eq('sender_id', currentUser.id).order('created_at', { ascending: false }).limit(1);
        const receipts = chat.querySelectorAll('.read-receipt');
        if (receipts.length) receipts[receipts.length - 1].style.color = '#4fc3f7';
      }, 1500);
    }
  }
  inp.value = '';
}

async function startConversation(listingId, sellerId) {
  if (!window.currentUser) { showModal('loginModal'); return; }
  if (sellerId === currentUser.id) { showToast('Saját hirdetésedre nem küldhetsz üzenetet!', 'error'); return; }

  // Meglévő szál keresés
  const { data: existing } = await sb.from('message_threads')
    .select('id').eq('listing_id', listingId).eq('buyer_id', currentUser.id).single();

  let threadId = existing?.id;
  if (!threadId) {
    const { data: thread } = await sb.from('message_threads').insert({
      listing_id: listingId, buyer_id: currentUser.id, seller_id: sellerId
    }).select().single();
    threadId = thread?.id;
  }

  window.activeThreadId = threadId;
  showModal('messagesModal');
  await loadThreadsFromDB();
}

// ============================================================
// 9. ÉRTÉKELÉSEK
// ============================================================

async function submitReview() {
  if (!window.currentUser) { showModal('loginModal'); return; }
  if (!selectedStar) { showToast('Válassz csillagot! ⭐', 'error'); return; }

  const comment = document.querySelector('#reviewModal textarea').value;
  const type = document.querySelector('#reviewModal input[name="revType"]:checked')?.value || 'buyer';

  const { error } = await sb.from('reviews').insert({
    reviewer_id: currentUser.id,
    reviewed_id: window.reviewTargetId,
    listing_id: window.reviewListingId,
    rating: selectedStar,
    comment,
    type
  });

  if (error) { showToast(error.message, 'error'); return; }

  await sb.rpc('add_loyalty_points', { user_id: currentUser.id, points: 5, reason: 'review_written' });
  closeModal('reviewModal');
  showToast('✅ Értékelés beküldve! Köszönjük!', 'success');
}

async function loadReviewsForUser(userId) {
  const { data } = await sb.from('reviews')
    .select('*, reviewer:profiles!reviewer_id(username)')
    .eq('reviewed_id', userId)
    .order('created_at', { ascending: false });
  return data || [];
}

// ============================================================
// 10. BEJELENTÉSEK
// ============================================================

async function submitReport() {
  if (!window.currentUser) { showModal('loginModal'); return; }
  const reason = document.getElementById('reportReason').value;
  const details = document.querySelector('#reportModal textarea').value;

  await sb.from('reports').insert({
    reporter_id: currentUser.id,
    listing_id: window.reportListingId,
    reason, details
  });

  closeModal('reportModal');
  showToast('🚨 Bejelentés elküldve! Hamarosan kivizsgáljuk.', 'success');
}

// ============================================================
// 11. FIZETÉS – BARION + PAYPAL API HÍVÁSOK
// ============================================================

async function processPayment() {
  if (!window.currentUser) { showModal('loginModal'); return; }

  const selectedMethod = document.querySelector('#paymentModal .payment-option.selected');
  if (!selectedMethod) { showToast('Válassz fizetési módot!', 'error'); return; }

  const method = selectedMethod.querySelector('.pay-name')?.textContent?.toLowerCase() || 'unknown';
  const listingId = window.paymentListingId;
  const amount = window.paymentAmount || 0;
  const listing = sampleListings.find(l => l.id == listingId);

  if (!listing) { showToast('Hirdetés nem található!', 'error'); return; }

  // Fizetési rekord létrehozása Supabase-ben
  const orderId = 'PT-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7).toUpperCase();

  const { data: payment, error } = await sb.from('payments').insert({
    order_id: orderId,
    listing_id: listingId,
    buyer_id: currentUser.id,
    seller_id: window.paymentSellerId,
    amount,
    method,
    status: 'pending'
  }).select().single();

  if (error) { showToast('Hiba a fizetés indításakor: ' + error.message, 'error'); return; }

  showToast('💳 Fizetés indítása...', 'info');

  if (method.includes('barion')) {
    await startBarionPayment(orderId, amount, listing, payment.id);
  } else if (method.includes('paypal')) {
    await startPayPalPayment(orderId, amount, listing, payment.id);
  } else if (method.includes('banki') || method.includes('utalás')) {
    showBankTransferInfo(orderId, amount);
  } else {
    // Készpénz
    closeModal('paymentModal');
    launchConfetti();
    showToast('✅ Rendelés leadva! Egyeztess az eladóval a személyes átadásról.', 'success');
  }
}

// ============================================================
// BARION FIZETÉS INDÍTÁSA
// ============================================================
async function startBarionPayment(orderId, amount, listing, paymentDbId) {
  try {
    const response = await fetch('/api/barion-payment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'start',
        orderId,
        amount,
        buyerEmail: currentUser.email,
        itemName: listing.title,
        itemDescription: listing.description || listing.title,
        redirectUrl: window.location.origin + '?payment=success&orderId=' + orderId,
        callbackUrl: window.location.origin + '/api/payment-webhook'
      })
    });

    const data = await response.json();

    if (!data.success) {
      showToast('Barion hiba: ' + (data.errors?.[0] || data.error), 'error');
      return;
    }

    // Barion Payment ID mentése
    await sb.from('payments').update({ barion_payment_id: data.paymentId }).eq('id', paymentDbId);

    // Átirányítás a Barion fizetési oldalra
    closeModal('paymentModal');
    showToast('🔄 Átirányítás a Barion biztonságos fizetési oldalra...', 'info');
    setTimeout(() => { window.location.href = data.redirectUrl; }, 1500);

  } catch (err) {
    showToast('Barion kapcsolódási hiba: ' + err.message, 'error');
  }
}

// ============================================================
// PAYPAL FIZETÉS INDÍTÁSA
// ============================================================
async function startPayPalPayment(orderId, amount, listing, paymentDbId) {
  try {
    const response = await fetch('/api/paypal-payment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'create',
        orderId,
        amount,
        buyerEmail: currentUser.email,
        itemName: listing.title,
        itemDescription: listing.description || listing.title,
        returnUrl: window.location.origin + '?payment=success&orderId=' + orderId,
        cancelUrl: window.location.origin + '?payment=cancelled'
      })
    });

    const data = await response.json();

    if (!data.success) {
      showToast('PayPal hiba: ' + data.error, 'error');
      return;
    }

    // PayPal Order ID mentése
    await sb.from('payments').update({ paypal_order_id: data.orderId }).eq('id', paymentDbId);

    // PayPal átirányítás
    closeModal('paymentModal');
    showToast('🔄 Átirányítás a PayPal fizetési oldalra...', 'info');

    // Ha PayPal JS SDK elérhető, abban nyitjuk meg
    if (typeof paypal !== 'undefined') {
      // PayPal popup mód
      window.open(data.approveUrl, '_blank', 'width=450,height=600');
    } else {
      setTimeout(() => { window.location.href = data.approveUrl; }, 1500);
    }

    // Visszatérés kezelése URL paraméterekből
    window.paypalOrderId = data.orderId;
    window.paypalPaymentDbId = paymentDbId;

  } catch (err) {
    showToast('PayPal kapcsolódási hiba: ' + err.message, 'error');
  }
}

// PayPal capture (miután visszajön a felhasználó)
async function capturePayPalPayment(paypalOrderId) {
  try {
    const response = await fetch('/api/paypal-payment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'capture', paypalOrderId })
    });
    const data = await response.json();
    if (data.success) {
      launchConfetti();
      showToast('🎉 PayPal fizetés sikeres! Köszönjük!', 'success');
    } else {
      showToast('PayPal fizetés sikertelen: ' + data.error, 'error');
    }
    return data;
  } catch (err) {
    showToast('PayPal capture hiba: ' + err.message, 'error');
  }
}

// ============================================================
// BANKI ÁTUTALÁS INFO
// ============================================================
function showBankTransferInfo(orderId, amount) {
  closeModal('paymentModal');
  const info = `
    <div style="text-align:center">
      <div style="font-size:2rem;margin-bottom:12px">🏦</div>
      <h3 style="margin-bottom:16px">Banki átutalás adatok</h3>
      <div style="background:var(--surface2);border-radius:var(--radius);padding:16px;text-align:left;font-size:0.88rem">
        <div style="margin-bottom:8px"><strong>Kedvezményezett:</strong> PiacTér Kft.</div>
        <div style="margin-bottom:8px"><strong>Számlaszám:</strong> 12345678-87654321-00000000</div>
        <div style="margin-bottom:8px"><strong>IBAN:</strong> HU12 1234 5678 8765 4321 0000 0000</div>
        <div style="margin-bottom:8px"><strong>Összeg:</strong> ${amount?.toLocaleString('hu-HU')} Ft</div>
        <div style="margin-bottom:8px"><strong>Közlemény:</strong> ${orderId}</div>
        <div style="color:var(--danger);font-size:0.8rem;margin-top:10px">⚠️ A közleményt pontosan add meg! Nélküle nem tudjuk azonosítani az utalást.</div>
      </div>
      <button class="btn btn-primary btn-lg" style="width:100%;margin-top:16px" onclick="navigator.clipboard.writeText('${orderId}').then(()=>showToast('📋 Közlemény másolva!','success'))">📋 Közlemény másolása</button>
    </div>`;

  document.getElementById('listingDetailBody').innerHTML = info;
  showModal('listingDetailModal');
  showToast('🏦 Banki átutalás adatok megjelenítve', 'info');
}

// ============================================================
// URL PARAMÉTEREK KEZELÉSE (visszatérés után)
// ============================================================
(function handlePaymentReturn() {
  const params = new URLSearchParams(window.location.search);
  const paymentStatus = params.get('payment');
  const orderId = params.get('orderId');
  const paypalToken = params.get('token'); // PayPal visszatéréskor

  if (paymentStatus === 'success') {
    setTimeout(() => {
      launchConfetti();
      showToast('🎉 Fizetés sikeres! Rendelés azonosító: ' + orderId, 'success');
      if (paypalToken && window.paypalOrderId) capturePayPalPayment(window.paypalOrderId);
    }, 500);
    // URL tisztítás
    window.history.replaceState({}, document.title, window.location.pathname);
  } else if (paymentStatus === 'failed') {
    showToast('❌ A fizetés sikertelen volt. Kérjük próbáld újra!', 'error');
    window.history.replaceState({}, document.title, window.location.pathname);
  } else if (paymentStatus === 'cancelled') {
    showToast('↩️ Fizetés megszakítva.', 'info');
    window.history.replaceState({}, document.title, window.location.pathname);
  }
})();

// ============================================================
// 12. KIEMELÉS (BOOST)
// ============================================================

async function purchaseBoost(listingId, boostType) {
  if (!window.currentUser) { showModal('loginModal'); return; }

  const prices = { featured: 990, premium: 1990, turbo: 4990 };
  const durations = { featured: 7, premium: 14, turbo: 30 };
  const amount = prices[boostType];
  const days = durations[boostType];

  const endsAt = new Date();
  endsAt.setDate(endsAt.getDate() + days);

  const { error } = await sb.from('boost_orders').insert({
    listing_id: listingId,
    user_id: currentUser.id,
    boost_type: boostType,
    amount,
    status: 'pending',
    ends_at: endsAt.toISOString()
  });

  if (error) { showToast(error.message, 'error'); return; }

  // Demo: fizetés után aktivál
  await sb.from('listings').update({
    boost_type: boostType,
    boost_until: endsAt.toISOString()
  }).eq('id', listingId);

  showToast(`⭐ ${boostType.toUpperCase()} kiemelés aktiválva ${days} napra!`, 'success');
  await loadListingsFromDB();
}

// ============================================================
// 13. ÉRTESÍTÉSEK
// ============================================================

async function loadNotificationsFromDB() {
  if (!window.currentUser) return;
  const { data } = await sb.from('notifications')
    .select('*').eq('user_id', currentUser.id)
    .order('created_at', { ascending: false }).limit(20);

  if (!data) return;
  const unread = data.filter(n => !n.is_read).length;
  if (unread > 0) document.querySelector('.notif-dot')?.style.setProperty('display', 'block');

  const c = document.getElementById('notifList');
  if (c) c.innerHTML = data.map(n => `
    <div style="display:flex;gap:12px;padding:12px;border-bottom:1px solid var(--border);align-items:flex-start;${!n.is_read ? 'background:var(--surface2)' : ''}">
      <span style="font-size:1.4rem">${notifIcon(n.type)}</span>
      <div style="flex:1"><div style="font-size:0.88rem;font-weight:${!n.is_read ? '600' : '400'}">${n.message}</div>
      <div style="font-size:0.75rem;color:var(--text2);margin-top:4px">${timeAgo(n.created_at)}</div></div>
    </div>`).join('');

  // Olvasottnak jelöl
  await sb.from('notifications').update({ is_read: true }).eq('user_id', currentUser.id).eq('is_read', false);
}

function notifIcon(type) {
  const icons = { message: '💬', sale: '💰', review: '⭐', favorite: '❤️', boost: '⭐', system: '📢' };
  return icons[type] || '🔔';
}

// ============================================================
// 14. MENTETT KERESÉSEK
// ============================================================

async function saveSearch(query, filters = {}) {
  if (!window.currentUser) { showModal('loginModal'); return; }
  await sb.from('saved_searches').insert({
    user_id: currentUser.id,
    query,
    min_price: filters.minPrice,
    max_price: filters.maxPrice,
    location: filters.location,
    notify_email: true
  });
  showToast('🔔 Keresés mentve! Értesítünk az új találatokról.', 'success');
}

// ============================================================
// 15. AUKCIÓ
// ============================================================

async function placeBid() {
  if (!window.currentUser) { showModal('loginModal'); return; }
  const amount = parseInt(document.getElementById('myBidInput').value);

  if (!amount || amount <= auctionCurrent) {
    showToast('A licited legalább ' + (auctionCurrent + 1000).toLocaleString('hu-HU') + ' Ft legyen!', 'error'); return;
  }

  const { error } = await sb.from('auction_bids').insert({
    listing_id: window.auctionListingId,
    user_id: currentUser.id,
    amount
  });

  if (error) { showToast(error.message, 'error'); return; }

  await sb.from('listings').update({ auction_current_price: amount }).eq('id', window.auctionListingId);

  auctionCurrent = amount;
  auctionBids.unshift({ user: currentProfile?.username || 'Te', amount, time: new Date().toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' }) });
  document.getElementById('auctionLeader').textContent = 'Legmagasabb licitáló: Te 🎉';
  renderAuctionBids();
  document.getElementById('myBidInput').value = '';
  showToast('🔨 Licit leadva: ' + amount.toLocaleString('hu-HU') + ' Ft!', 'success');
}

// ============================================================
// 16. REALTIME FELIRATKOZÁSOK
// ============================================================

function setupRealtimeSubscriptions() {
  if (!window.currentUser) return;

  // Új üzenet figyelés
  sb.channel('messages')
    .on('postgres_changes', {
      event: 'INSERT', schema: 'public', table: 'messages'
    }, payload => {
      if (payload.new.sender_id !== currentUser?.id) {
        showToast('💬 Új üzenet érkezett!', 'info');
        document.querySelector('.notif-dot')?.style.setProperty('display', 'block');
        if (window.activeThreadId === payload.new.thread_id) {
          const chat = document.getElementById('chatMessages');
          if (chat) {
            chat.innerHTML += `<div class="chat-msg"><div class="chat-bubble">${payload.new.content}</div><div style="font-size:0.7rem;color:var(--text2);margin-top:3px">Most</div></div>`;
            chat.scrollTop = chat.scrollHeight;
          }
        }
      }
    })
    .subscribe();

  // Értesítések figyelés
  sb.channel('notifications_' + currentUser.id)
    .on('postgres_changes', {
      event: 'INSERT', schema: 'public', table: 'notifications',
      filter: `user_id=eq.${currentUser.id}`
    }, payload => {
      showToast('🔔 ' + payload.new.message, 'info');
      loadNotificationsFromDB();
    })
    .subscribe();

  // Aukciós licit figyelés
  sb.channel('auction_bids')
    .on('postgres_changes', {
      event: 'INSERT', schema: 'public', table: 'auction_bids'
    }, payload => {
      if (window.auctionListingId === payload.new.listing_id && payload.new.user_id !== currentUser?.id) {
        auctionCurrent = payload.new.amount;
        renderAuctionBids();
        showToast('🔨 Új licit érkezett: ' + payload.new.amount.toLocaleString('hu-HU') + ' Ft!', 'info');
      }
    })
    .subscribe();
}

// ============================================================
// 17. ADMIN FUNKCIÓK
// ============================================================

async function adminBanListing(listingId) {
  if (!window.currentUser) return;
  await sb.from('listings').update({ status: 'banned' }).eq('id', listingId);
  showToast('🚫 Hirdetés tiltva!', 'success');
  await loadListingsFromDB();
}

async function adminBanUser(userId) {
  if (!window.currentUser) return;
  await sb.from('profiles').update({ is_banned: true }).eq('id', userId);
  showToast('🚫 Felhasználó tiltva!', 'success');
}

async function loadAdminStats() {
  const [listings, users, payments] = await Promise.all([
    sb.from('listings').select('id', { count: 'exact' }),
    sb.from('profiles').select('id', { count: 'exact' }),
    sb.from('payments').select('amount').eq('status', 'paid')
  ]);

  const totalRevenue = payments.data?.reduce((sum, p) => sum + p.amount, 0) || 0;
  return {
    listings: listings.count || 0,
    users: users.count || 0,
    revenue: totalRevenue
  };
}

// ============================================================
// 18. SEGÉDFÜGGVÉNYEK
// ============================================================

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = (Date.now() - new Date(dateStr)) / 1000;
  if (diff < 60) return 'Épp most';
  if (diff < 3600) return Math.floor(diff / 60) + ' perce';
  if (diff < 86400) return Math.floor(diff / 3600) + ' órája';
  if (diff < 604800) return Math.floor(diff / 86400) + ' napja';
  return new Date(dateStr).toLocaleDateString('hu-HU');
}

function conditionLabel(val) {
  const map = { new: 'Új', like_new: 'Újszerű', good: 'Jó állapotú', used: 'Használt', for_parts: 'Alkatrésznek' };
  return map[val] || val;
}

function conditionValue(label) {
  const map = { 'Új': 'new', 'Újszerű': 'like_new', 'Jó állapotú': 'good', 'Használt': 'used', 'Alkatrésznek': 'for_parts' };
  return map[label] || 'good';
}

function updateUIForLoggedInUser() {
  const p = window.currentProfile;
  if (!p) return;
  document.querySelectorAll('[onclick="showModal(\'loginModal\')"]').forEach(b => {
    b.textContent = '👤 ' + (p.username || '');
    b.onclick = () => showModal('profileModal');
  });
}

function updateUIForLoggedOutUser() {
  document.querySelectorAll('.user-btn').forEach(b => {
    b.textContent = '👤 Profil ▾';
    b.onclick = () => toggleDropdown('userDD');
  });
}

// ============================================================
// 19. CLOUDINARY KÉPFELTÖLTÉS (alternatíva a Supabase Storage helyett)
// ============================================================

const CLOUDINARY_CLOUD_NAME = 'YOUR_CLOUD_NAME';
const CLOUDINARY_UPLOAD_PRESET = 'piacter_unsigned';

async function uploadToCloudinary(file) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
  formData.append('folder', 'piacter/listings');

  try {
    const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`, {
      method: 'POST', body: formData
    });
    const data = await res.json();
    return data.secure_url;
  } catch { return null; }
}

// ============================================================
// 20. PWA MANIFEST TARTALOM (manifest.json fájlba menteni)
// ============================================================
/*
{
  "name": "PiacTér",
  "short_name": "PiacTér",
  "description": "Magyarország legjobb online piactere",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#f8f9fa",
  "theme_color": "#e85d04",
  "orientation": "portrait-primary",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ],
  "categories": ["shopping", "lifestyle"],
  "lang": "hu",
  "shortcuts": [
    { "name": "Hirdetés feladása", "url": "/?action=new-listing", "icons": [{ "src": "/icon-192.png", "sizes": "192x192" }] },
    { "name": "Keresés", "url": "/?action=search", "icons": [{ "src": "/icon-192.png", "sizes": "192x192" }] }
  ]
}
*/
