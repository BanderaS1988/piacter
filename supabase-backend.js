// ============================================================
// PIACTÉR – TELJES SUPABASE BACKEND (10/10)
// Futtasd le a Supabase SQL Editorban SORBAN!
// ============================================================

// ============================================================
// 0. EXTENSIONS
// ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "unaccent";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ============================================================
    --1. TÁBLÁK
-- ============================================================

    CREATE TABLE profiles(
        id                UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
        username          TEXT UNIQUE NOT NULL,
        full_name         TEXT,
        email             TEXT,
        phone             TEXT,
        location          TEXT,
        zip               TEXT,
        avatar_url        TEXT,
        bio               TEXT,
        is_verified       BOOLEAN DEFAULT FALSE,
        is_banned         BOOLEAN DEFAULT FALSE,
        is_admin          BOOLEAN DEFAULT FALSE,
        loyalty_points    INTEGER DEFAULT 0,
        loyalty_level     TEXT DEFAULT 'bronze' CHECK(loyalty_level IN('bronze', 'silver', 'gold', 'platinum')),
        referral_code     TEXT UNIQUE DEFAULT upper(substring(gen_random_uuid():: text, 1, 8)),
        referred_by       UUID REFERENCES profiles(id) ON DELETE SET NULL,
        total_sales       INTEGER DEFAULT 0,
        total_purchases   INTEGER DEFAULT 0,
        response_rate     NUMERIC(5, 2) DEFAULT 100.00,
        last_seen         TIMESTAMPTZ DEFAULT NOW(),
        created_at        TIMESTAMPTZ DEFAULT NOW(),
        updated_at        TIMESTAMPTZ DEFAULT NOW()
    );

CREATE TABLE categories(
        id            SERIAL PRIMARY KEY,
        name          TEXT NOT NULL,
        slug          TEXT UNIQUE NOT NULL,
        icon          TEXT,
        parent_id     INTEGER REFERENCES categories(id) ON DELETE SET NULL,
        listing_count INTEGER DEFAULT 0,
        sort_order    INTEGER DEFAULT 0,
        is_active     BOOLEAN DEFAULT TRUE
    );

CREATE TABLE listings(
        id                   UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        user_id              UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
        title                TEXT NOT NULL CHECK(char_length(title) BETWEEN 3 AND 150),
        description          TEXT CHECK(char_length(description) <= 5000),
        price                INTEGER NOT NULL CHECK(price >= 0),
        negotiable           BOOLEAN DEFAULT FALSE,
        condition            TEXT CHECK(condition IN('new', 'like_new', 'good', 'used', 'for_parts')) DEFAULT 'good',
        category_id          INTEGER REFERENCES categories(id) ON DELETE SET NULL,
        location             TEXT,
        zip                  TEXT,
        shipping             TEXT DEFAULT 'both' CHECK(shipping IN('personal', 'shipping', 'both')),
        shipping_cost        INTEGER DEFAULT 0 CHECK(shipping_cost >= 0),
        payment_methods      TEXT[] DEFAULT ARRAY['cash'],
        images               TEXT[] DEFAULT ARRAY[]:: TEXT[],
        status               TEXT CHECK(status IN('active', 'sold', 'expired', 'draft', 'banned')) DEFAULT 'active',
        boost_type           TEXT CHECK(boost_type IN('none', 'featured', 'premium', 'turbo')) DEFAULT 'none',
        boost_until          TIMESTAMPTZ,
        views                INTEGER DEFAULT 0,
        watchers             INTEGER DEFAULT 0,
        is_auction           BOOLEAN DEFAULT FALSE,
        auction_start_price  INTEGER CHECK(auction_start_price > 0),
        auction_current_price INTEGER,
        auction_end_time     TIMESTAMPTZ,
        search_vector        TSVECTOR,
        created_at           TIMESTAMPTZ DEFAULT NOW(),
        updated_at           TIMESTAMPTZ DEFAULT NOW(),
        expires_at           TIMESTAMPTZ DEFAULT NOW() + INTERVAL '30 days'
    );

--Full - text search index
CREATE INDEX listings_search_idx ON listings USING GIN(search_vector);
CREATE INDEX listings_status_idx ON listings(status);
CREATE INDEX listings_user_idx ON listings(user_id);
CREATE INDEX listings_cat_idx ON listings(category_id);
CREATE INDEX listings_boost_idx ON listings(boost_type, created_at DESC);
CREATE INDEX listings_price_idx ON listings(price);

CREATE TABLE auction_bids(
    id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    listing_id  UUID REFERENCES listings(id) ON DELETE CASCADE NOT NULL,
    user_id     UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
    amount      INTEGER NOT NULL CHECK(amount > 0),
    is_auto     BOOLEAN DEFAULT FALSE,
    auto_max    INTEGER,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX auction_bids_listing_idx ON auction_bids(listing_id, amount DESC);

CREATE TABLE message_threads(
    id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    listing_id       UUID REFERENCES listings(id) ON DELETE SET NULL,
    buyer_id         UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
    seller_id        UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
    last_message     TEXT,
    last_message_at  TIMESTAMPTZ DEFAULT NOW(),
    buyer_unread     INTEGER DEFAULT 0,
    seller_unread    INTEGER DEFAULT 0,
    is_archived_buyer   BOOLEAN DEFAULT FALSE,
    is_archived_seller  BOOLEAN DEFAULT FALSE,
    created_at       TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(listing_id, buyer_id)
);

CREATE INDEX threads_buyer_idx  ON message_threads(buyer_id, last_message_at DESC);
CREATE INDEX threads_seller_idx ON message_threads(seller_id, last_message_at DESC);

CREATE TABLE messages(
    id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    thread_id   UUID REFERENCES message_threads(id) ON DELETE CASCADE NOT NULL,
    sender_id   UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
    content     TEXT NOT NULL CHECK(char_length(content) BETWEEN 1 AND 2000),
    is_read     BOOLEAN DEFAULT FALSE,
    read_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX messages_thread_idx ON messages(thread_id, created_at);

CREATE TABLE reviews(
    id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    reviewer_id  UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
    reviewed_id  UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
    listing_id   UUID REFERENCES listings(id) ON DELETE SET NULL,
    rating       INTEGER CHECK(rating BETWEEN 1 AND 5) NOT NULL,
    comment      TEXT CHECK(char_length(comment) <= 1000),
    type         TEXT CHECK(type IN('buyer', 'seller')) DEFAULT 'seller',
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(reviewer_id, listing_id)
);

CREATE TABLE favorites(
    id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id     UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
    listing_id  UUID REFERENCES listings(id) ON DELETE CASCADE NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, listing_id)
);

CREATE INDEX favorites_user_idx ON favorites(user_id);

CREATE TABLE reports(
    id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    reporter_id  UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
    listing_id   UUID REFERENCES listings(id) ON DELETE CASCADE,
    reported_user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    reason       TEXT NOT NULL,
    details      TEXT CHECK(char_length(details) <= 1000),
    status       TEXT DEFAULT 'pending' CHECK(status IN('pending', 'reviewed', 'resolved', 'dismissed')),
    admin_note   TEXT,
    resolved_by  UUID REFERENCES profiles(id) ON DELETE SET NULL,
    resolved_at  TIMESTAMPTZ,
    created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE payments(
    id                 UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    order_id           TEXT UNIQUE NOT NULL,
    listing_id         UUID REFERENCES listings(id) ON DELETE SET NULL,
    buyer_id           UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
    seller_id          UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
    amount             INTEGER NOT NULL CHECK(amount > 0),
    platform_fee       INTEGER DEFAULT 0,
    seller_amount      INTEGER,
    method             TEXT NOT NULL CHECK(method IN('barion', 'paypal', 'bank_transfer', 'cash')),
    status             TEXT CHECK(status IN('pending', 'paid', 'refunded', 'failed', 'expired')) DEFAULT 'pending',
    transaction_id     TEXT,
    barion_payment_id  TEXT,
    paypal_order_id    TEXT,
    paypal_capture_id  TEXT,
    bank_reference     TEXT,
    refund_reason      TEXT,
    refunded_at        TIMESTAMPTZ,
    created_at         TIMESTAMPTZ DEFAULT NOW(),
    updated_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX payments_buyer_idx  ON payments(buyer_id);
CREATE INDEX payments_seller_idx ON payments(seller_id);
CREATE INDEX payments_status_idx ON payments(status);

CREATE TABLE boost_orders(
    id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    listing_id  UUID REFERENCES listings(id) ON DELETE CASCADE NOT NULL,
    user_id     UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
    boost_type  TEXT NOT NULL CHECK(boost_type IN('featured', 'premium', 'turbo')),
    amount      INTEGER NOT NULL CHECK(amount > 0),
    method      TEXT,
    status      TEXT DEFAULT 'pending' CHECK(status IN('pending', 'active', 'expired', 'cancelled')),
    starts_at   TIMESTAMPTZ DEFAULT NOW(),
    ends_at     TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE notifications(
    id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id     UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
    type        TEXT NOT NULL CHECK(type IN('message', 'sale', 'purchase', 'review', 'favorite', 'boost', 'system', 'refund', 'auction', 'referral')),
    title       TEXT,
    message     TEXT NOT NULL CHECK(char_length(message) <= 500),
    data        JSONB DEFAULT '{}':: JSONB,
    is_read     BOOLEAN DEFAULT FALSE,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX notifications_user_idx ON notifications(user_id, is_read, created_at DESC);

CREATE TABLE saved_searches(
    id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id       UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
    name          TEXT,
    query         TEXT,
    category_id   INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    min_price     INTEGER,
    max_price     INTEGER,
    location      TEXT,
    condition     TEXT,
    notify_email  BOOLEAN DEFAULT TRUE,
    notify_push   BOOLEAN DEFAULT FALSE,
    last_notified TIMESTAMPTZ,
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE listing_views(
    id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    listing_id  UUID REFERENCES listings(id) ON DELETE CASCADE NOT NULL,
    viewer_id   UUID REFERENCES profiles(id) ON DELETE SET NULL,
    ip_hash     TEXT,
    user_agent  TEXT,
    viewed_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX listing_views_listing_idx ON listing_views(listing_id, viewed_at DESC);

CREATE TABLE referrals(
    id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    referrer_id    UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
    referred_id    UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
    status         TEXT DEFAULT 'pending' CHECK(status IN('pending', 'completed', 'cancelled')),
    reward_points  INTEGER DEFAULT 100,
    paid_at        TIMESTAMPTZ,
    created_at     TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(referred_id)
);

CREATE TABLE loyalty_transactions(
    id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id     UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
    points      INTEGER NOT NULL,
    reason      TEXT NOT NULL,
    reference   TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX loyalty_user_idx ON loyalty_transactions(user_id, created_at DESC);

CREATE TABLE admin_logs(
    id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    admin_id    UUID REFERENCES profiles(id) ON DELETE SET NULL,
    action      TEXT NOT NULL,
    target_type TEXT,
    target_id   TEXT,
    details     JSONB DEFAULT '{}':: JSONB,
    ip_address  TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE banned_words(
    id         SERIAL PRIMARY KEY,
    word       TEXT UNIQUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE processed_webhooks(
    id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    webhook_id   TEXT UNIQUE NOT NULL,
    source       TEXT NOT NULL,
    processed_at TIMESTAMPTZ NOT NULL,
    created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
    --2. RLS ENGEDÉLYEZÉS
-- ============================================================

    ALTER TABLE profiles           ENABLE ROW LEVEL SECURITY;
ALTER TABLE listings           ENABLE ROW LEVEL SECURITY;
ALTER TABLE auction_bids       ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_threads    ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages           ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviews            ENABLE ROW LEVEL SECURITY;
ALTER TABLE favorites          ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports            ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments           ENABLE ROW LEVEL SECURITY;
ALTER TABLE boost_orders       ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications      ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_searches     ENABLE ROW LEVEL SECURITY;
ALTER TABLE listing_views      ENABLE ROW LEVEL SECURITY;
ALTER TABLE referrals          ENABLE ROW LEVEL SECURITY;
ALTER TABLE loyalty_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_logs         ENABLE ROW LEVEL SECURITY;

ALTER TABLE processed_webhooks ENABLE ROW LEVEL SECURITY;
-- ============================================================
    --3. RLS POLICY - K
-- ============================================================

    --PROFILES
CREATE POLICY "profiles_public_read"
  ON profiles FOR SELECT USING(true);

CREATE POLICY "profiles_own_insert"
  ON profiles FOR INSERT WITH CHECK(auth.uid() = id);

CREATE POLICY "profiles_own_update"
  ON profiles FOR UPDATE USING(auth.uid() = id)
  WITH CHECK(auth.uid() = id AND is_admin = FALSE);

--LISTINGS
CREATE POLICY "listings_public_read"
  ON listings FOR SELECT
USING(status = 'active' OR auth.uid() = user_id);

CREATE POLICY "listings_own_insert"
  ON listings FOR INSERT
  WITH CHECK(auth.uid() = user_id);

CREATE POLICY "listings_own_update"
  ON listings FOR UPDATE
USING(auth.uid() = user_id)
  WITH CHECK(auth.uid() = user_id);

CREATE POLICY "listings_own_delete"
  ON listings FOR DELETE
USING(auth.uid() = user_id);

--AUCTION BIDS
CREATE POLICY "auction_bids_public_read"
  ON auction_bids FOR SELECT USING(true);

CREATE POLICY "auction_bids_own_insert"
  ON auction_bids FOR INSERT
  WITH CHECK(auth.uid() = user_id);

--MESSAGE THREADS
CREATE POLICY "threads_participant_read"
  ON message_threads FOR SELECT
USING(auth.uid() = buyer_id OR auth.uid() = seller_id);

CREATE POLICY "threads_buyer_insert"
  ON message_threads FOR INSERT
  WITH CHECK(auth.uid() = buyer_id);

CREATE POLICY "threads_participant_update"
  ON message_threads FOR UPDATE
USING(auth.uid() = buyer_id OR auth.uid() = seller_id);

--MESSAGES
CREATE POLICY "messages_participant_read"
  ON messages FOR SELECT
USING(
    EXISTS(
        SELECT 1 FROM message_threads mt
      WHERE mt.id = thread_id
        AND(mt.buyer_id = auth.uid() OR mt.seller_id = auth.uid())
    )
);

CREATE POLICY "messages_own_insert"
  ON messages FOR INSERT
  WITH CHECK(
    auth.uid() = sender_id AND
    EXISTS(
        SELECT 1 FROM message_threads mt
      WHERE mt.id = thread_id
        AND(mt.buyer_id = auth.uid() OR mt.seller_id = auth.uid())
    )
);

--REVIEWS
CREATE POLICY "reviews_public_read"
  ON reviews FOR SELECT USING(true);

CREATE POLICY "reviews_own_insert"
  ON reviews FOR INSERT
  WITH CHECK(auth.uid() = reviewer_id AND auth.uid() <> reviewed_id);

--FAVORITES
CREATE POLICY "favorites_own_all"
  ON favorites FOR ALL
USING(auth.uid() = user_id)
  WITH CHECK(auth.uid() = user_id);

--REPORTS
CREATE POLICY "reports_own_insert"
  ON reports FOR INSERT
  WITH CHECK(auth.uid() = reporter_id);

CREATE POLICY "reports_own_read"
  ON reports FOR SELECT
USING(auth.uid() = reporter_id);

--PAYMENTS
CREATE POLICY "payments_parties_read"
  ON payments FOR SELECT
USING(auth.uid() = buyer_id OR auth.uid() = seller_id);

CREATE POLICY "payments_buyer_insert"
  ON payments FOR INSERT
  WITH CHECK(auth.uid() = buyer_id);

CREATE POLICY "payments_buyer_update"
  ON payments FOR UPDATE
USING(auth.uid() = buyer_id);

--BOOST ORDERS
CREATE POLICY "boost_own_all"
  ON boost_orders FOR ALL
USING(auth.uid() = user_id)
  WITH CHECK(auth.uid() = user_id);

--NOTIFICATIONS
CREATE POLICY "notifications_own_all"
  ON notifications FOR ALL
USING(auth.uid() = user_id);

--SAVED SEARCHES
CREATE POLICY "saved_searches_own_all"
  ON saved_searches FOR ALL
USING(auth.uid() = user_id)
  WITH CHECK(auth.uid() = user_id);

--LISTING VIEWS
CREATE POLICY "listing_views_insert_all"
  ON listing_views FOR INSERT
  WITH CHECK(true);

CREATE POLICY "listing_views_own_read"
  ON listing_views FOR SELECT
USING(
    viewer_id = auth.uid() OR
    EXISTS(SELECT 1 FROM listings l WHERE l.id = listing_id AND l.user_id = auth.uid())
);

--REFERRALS
CREATE POLICY "referrals_own_read"
  ON referrals FOR SELECT
USING(auth.uid() = referrer_id OR auth.uid() = referred_id);

--LOYALTY TRANSACTIONS
CREATE POLICY "loyalty_own_read"
  ON loyalty_transactions FOR SELECT
USING(auth.uid() = user_id);

--ADMIN LOGS – csak admin olvashatja
CREATE POLICY "admin_logs_admin_only"
  ON admin_logs FOR ALL
USING(
    EXISTS(SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE)
);

-- ============================================================
    --4. FÜGGVÉNYEK
-- ============================================================

    --Új user profil automatikus létrehozása
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  base_username TEXT;
  final_username TEXT;
  counter INTEGER:= 0;
BEGIN
base_username:= COALESCE(
    NEW.raw_user_meta_data ->> 'username',
    split_part(NEW.email, '@', 1)
);
base_username:= regexp_replace(base_username, '[^a-zA-Z0-9_]', '', 'g');
  IF char_length(base_username) < 3 THEN
base_username:= 'user' || substring(NEW.id:: text, 1, 6);
  END IF;
final_username:= base_username;

--Egyedi username keresés
LOOP
    EXIT WHEN NOT EXISTS(SELECT 1 FROM profiles WHERE username = final_username);
counter:= counter + 1;
final_username:= base_username || counter:: text;
  END LOOP;

  INSERT INTO profiles(id, username, full_name, email, referral_code)
VALUES(
    NEW.id,
    final_username,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', final_username),
    NEW.email,
    upper(substring(gen_random_uuid():: text, 1, 8))
);
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- -------------------------------------------------------
    --Loyalty pontok hozzáadása(tranzakció - biztos)
-- -------------------------------------------------------
    CREATE OR REPLACE FUNCTION add_loyalty_points(
        p_user_id UUID,
        p_points  INTEGER,
        p_reason  TEXT,
        p_reference TEXT DEFAULT NULL
    )
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  new_points INTEGER;
  new_level  TEXT;
BEGIN
  UPDATE profiles
    SET loyalty_points = loyalty_points + p_points,
    updated_at = NOW()
  WHERE id = p_user_id
  RETURNING loyalty_points INTO new_points;

  IF NOT FOUND THEN RETURN 0; END IF;

new_level:= CASE
    WHEN new_points >= 5000 THEN 'platinum'
    WHEN new_points >= 2000 THEN 'gold'
    WHEN new_points >= 500  THEN 'silver'
    ELSE 'bronze'
END;

  UPDATE profiles SET loyalty_level = new_level WHERE id = p_user_id;

  INSERT INTO loyalty_transactions(user_id, points, reason, reference)
VALUES(p_user_id, p_points, p_reason, p_reference);

  RETURN new_points;
END;
$$;

-- -------------------------------------------------------
    --Hirdetés view számláló(IP alapú duplikáció - szűréssel)
-- -------------------------------------------------------
    CREATE OR REPLACE FUNCTION increment_listing_views(
        p_listing_id UUID,
        p_viewer_id  UUID DEFAULT NULL,
        p_ip_hash    TEXT DEFAULT NULL
    )
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  already_seen BOOLEAN;
BEGIN
--Duplikáció szűrés: ugyanaz az IP / user 1 órán belül ne számolja újra
  SELECT EXISTS(
    SELECT 1 FROM listing_views
    WHERE listing_id = p_listing_id
      AND(
        (p_viewer_id IS NOT NULL AND viewer_id = p_viewer_id) OR
    (p_ip_hash IS NOT NULL AND ip_hash = p_ip_hash)
)
      AND viewed_at > NOW() - INTERVAL '1 hour'
  ) INTO already_seen;

  IF NOT already_seen THEN
    UPDATE listings SET views = views + 1 WHERE id = p_listing_id;
    INSERT INTO listing_views(listing_id, viewer_id, ip_hash)
VALUES(p_listing_id, p_viewer_id, p_ip_hash);
  END IF;
END;
$$;

-- -------------------------------------------------------
    --Felhasználó átlagos értékelése
-- -------------------------------------------------------
    CREATE OR REPLACE FUNCTION get_user_rating(p_user_id UUID)
RETURNS NUMERIC LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT ROUND(COALESCE(AVG(rating), 0):: NUMERIC, 2)
  FROM reviews WHERE reviewed_id = p_user_id;
$$;

-- -------------------------------------------------------
    --Lejárt hirdetések törlése(cron job hívja)
-- -------------------------------------------------------
    CREATE OR REPLACE FUNCTION expire_old_listings()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  expired_count INTEGER;
BEGIN
  UPDATE listings
    SET status = 'expired', updated_at = NOW()
  WHERE status = 'active' AND expires_at < NOW();
  GET DIAGNOSTICS expired_count = ROW_COUNT;
  RETURN expired_count;
END;
$$;

-- -------------------------------------------------------
    --Lejárt boost - ok visszaállítása
-- -------------------------------------------------------
    CREATE OR REPLACE FUNCTION expire_old_boosts()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cnt INTEGER;
BEGIN
  UPDATE listings
    SET boost_type = 'none', boost_until = NULL, updated_at = NOW()
  WHERE boost_type <> 'none' AND boost_until < NOW();
  GET DIAGNOSTICS cnt = ROW_COUNT;

  UPDATE boost_orders
    SET status = 'expired'
  WHERE status = 'active' AND ends_at < NOW();

  RETURN cnt;
END;
$$;

-- -------------------------------------------------------
    --Kategória hirdetésszám frissítő trigger
-- -------------------------------------------------------
    CREATE OR REPLACE FUNCTION update_category_count()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  affected_id INTEGER;
BEGIN
  IF TG_OP = 'DELETE' THEN
affected_id:= OLD.category_id;
  ELSIF TG_OP = 'UPDATE' AND OLD.category_id IS DISTINCT FROM NEW.category_id THEN
--Régi kategória frissítése
    IF OLD.category_id IS NOT NULL THEN
      UPDATE categories SET listing_count = (
    SELECT COUNT(*) FROM listings
        WHERE category_id = OLD.category_id AND status = 'active'
      ) WHERE id = OLD.category_id;
    END IF;
affected_id:= NEW.category_id;
ELSE
affected_id:= NEW.category_id;
  END IF;

  IF affected_id IS NOT NULL THEN
    UPDATE categories SET listing_count = (
    SELECT COUNT(*) FROM listings
      WHERE category_id = affected_id AND status = 'active'
    ) WHERE id = affected_id;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

CREATE TRIGGER update_cat_count
  AFTER INSERT OR UPDATE OF status, category_id OR DELETE
  ON listings
  FOR EACH ROW EXECUTE FUNCTION update_category_count();

-- -------------------------------------------------------
    --Full - text search vektor frissítő trigger
-- -------------------------------------------------------
    CREATE OR REPLACE FUNCTION update_listing_search_vector()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
NEW.search_vector :=
setweight(to_tsvector('hungarian', COALESCE(NEW.title, '')), 'A') ||
    setweight(to_tsvector('hungarian', COALESCE(NEW.description, '')), 'B') ||
    setweight(to_tsvector('simple', COALESCE(NEW.location, '')), 'C');
  RETURN NEW;
END;
$$;

CREATE TRIGGER listing_search_vector_update
  BEFORE INSERT OR UPDATE OF title, description, location
  ON listings
  FOR EACH ROW EXECUTE FUNCTION update_listing_search_vector();

-- -------------------------------------------------------
    --Üzenet szál updated_at + unread számláló trigger
-- -------------------------------------------------------
    CREATE OR REPLACE FUNCTION handle_new_message()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  thread message_threads % ROWTYPE;
BEGIN
SELECT * INTO thread FROM message_threads WHERE id = NEW.thread_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  IF NEW.sender_id = thread.buyer_id THEN
    UPDATE message_threads
      SET last_message = NEW.content,
    last_message_at = NEW.created_at,
    seller_unread = seller_unread + 1
      WHERE id = NEW.thread_id;
ELSE
    UPDATE message_threads
      SET last_message = NEW.content,
    last_message_at = NEW.created_at,
    buyer_unread = buyer_unread + 1
      WHERE id = NEW.thread_id;
  END IF;

--Értesítés a másik félnek
  INSERT INTO notifications(user_id, type, title, message, data)
VALUES(
    CASE WHEN NEW.sender_id = thread.buyer_id THEN thread.seller_id ELSE thread.buyer_id END,
    'message',
    '💬 Új üzenet',
    substring(NEW.content, 1, 100),
    jsonb_build_object('thread_id', NEW.thread_id, 'sender_id', NEW.sender_id)
);

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_new_message
  AFTER INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION handle_new_message();

-- -------------------------------------------------------
    --Profil updated_at automatikus frissítés
-- -------------------------------------------------------
    CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER profiles_updated_at   BEFORE UPDATE ON profiles   FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER listings_updated_at   BEFORE UPDATE ON listings   FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER payments_updated_at   BEFORE UPDATE ON payments   FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- -------------------------------------------------------
    --Referral feldolgozás
-- -------------------------------------------------------
    CREATE OR REPLACE FUNCTION process_referral(p_user_id UUID, p_ref_code TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  referrer_id UUID;
BEGIN
  IF p_ref_code IS NULL OR p_user_id IS NULL THEN RETURN FALSE; END IF;

  SELECT id INTO referrer_id FROM profiles
  WHERE referral_code = upper(p_ref_code) AND id <> p_user_id;

  IF referrer_id IS NULL THEN RETURN FALSE; END IF;

--Referral rekord beszúrása(egyedi, ha már létezik, sikertelen de nem dob hibát)
  INSERT INTO referrals(referrer_id, referred_id)
VALUES(referrer_id, p_user_id)
  ON CONFLICT(referred_id) DO NOTHING;

  IF FOUND THEN
    PERFORM add_loyalty_points(referrer_id, 100, 'referral_reward', p_user_id:: text);
    PERFORM add_loyalty_points(p_user_id, 50, 'referral_welcome', referrer_id:: text);
    UPDATE profiles SET referred_by = referrer_id WHERE id = p_user_id;
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$$;

-- -------------------------------------------------------
    --Értékelés leadásakor értesítés
-- -------------------------------------------------------
    CREATE OR REPLACE FUNCTION notify_on_review()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  reviewer_name TEXT;
BEGIN
  SELECT username INTO reviewer_name FROM profiles WHERE id = NEW.reviewer_id;
  INSERT INTO notifications(user_id, type, title, message, data)
VALUES(
    NEW.reviewed_id,
    'review',
    '⭐ Új értékelés',
    reviewer_name || ' ' || NEW.rating || ' csillagos értékelést hagyott rólad.',
    jsonb_build_object('review_id', NEW.id, 'rating', NEW.rating, 'reviewer_id', NEW.reviewer_id)
);
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_new_review
  AFTER INSERT ON reviews
  FOR EACH ROW EXECUTE FUNCTION notify_on_review();

-- -------------------------------------------------------
    --Licit leadásakor értesítés az eladónak és az előző licitálónak
-- -------------------------------------------------------
    CREATE OR REPLACE FUNCTION notify_on_bid()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  listing_rec  listings % ROWTYPE;
  prev_bidder  UUID;
  bidder_name  TEXT;
BEGIN
SELECT * INTO listing_rec FROM listings WHERE id = NEW.listing_id;
  SELECT username INTO bidder_name FROM profiles WHERE id = NEW.user_id;

--Értesítés az eladónak
  INSERT INTO notifications(user_id, type, title, message, data)
VALUES(
    listing_rec.user_id, 'auction',
    '🔨 Új licit érkezett',
    bidder_name || ' licitet ajánlott: ' || NEW.amount || ' Ft',
    jsonb_build_object('listing_id', NEW.listing_id, 'amount', NEW.amount)
);

--Az előző legmagasabb licitáló értesítése(ha más)
  SELECT user_id INTO prev_bidder
  FROM auction_bids
  WHERE listing_id = NEW.listing_id AND user_id <> NEW.user_id
  ORDER BY amount DESC LIMIT 1;

  IF prev_bidder IS NOT NULL THEN
    INSERT INTO notifications(user_id, type, title, message, data)
VALUES(
    prev_bidder, 'auction',
    '⚠️ Felülicitáltak',
    'Az ajánlatodat felülicitálták. Új legmagasabb ajánlat: ' || NEW.amount || ' Ft',
    jsonb_build_object('listing_id', NEW.listing_id, 'amount', NEW.amount)
);
  END IF;

--Aktuális aukciós ár frissítése
  UPDATE listings
    SET auction_current_price = NEW.amount, updated_at = NOW()
  WHERE id = NEW.listing_id AND(auction_current_price IS NULL OR auction_current_price < NEW.amount);

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_new_bid
  AFTER INSERT ON auction_bids
  FOR EACH ROW EXECUTE FUNCTION notify_on_bid();

-- -------------------------------------------------------
    --Keresési függvény teljes szöveges kereséshez
-- -------------------------------------------------------
    CREATE OR REPLACE FUNCTION search_listings(
        p_query       TEXT DEFAULT NULL,
        p_category_id INTEGER DEFAULT NULL,
        p_min_price   INTEGER DEFAULT NULL,
        p_max_price   INTEGER DEFAULT NULL,
        p_location    TEXT DEFAULT NULL,
        p_condition   TEXT DEFAULT NULL,
        p_limit       INTEGER DEFAULT 20,
        p_offset      INTEGER DEFAULT 0
    )
RETURNS TABLE(
        id UUID, title TEXT, price INTEGER, location TEXT,
        images TEXT[], condition TEXT, boost_type TEXT,
        views INTEGER, created_at TIMESTAMPTZ, rank REAL
    )
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  tsq TSQUERY;
BEGIN
  IF p_query IS NOT NULL AND p_query <> '' THEN
tsq:= plainto_tsquery('hungarian', p_query);
  END IF;

  RETURN QUERY
SELECT
l.id, l.title, l.price, l.location,
    l.images, l.condition, l.boost_type,
    l.views, l.created_at,
    CASE WHEN tsq IS NOT NULL THEN ts_rank(l.search_vector, tsq) ELSE 1.0 END AS rank
  FROM listings l
  WHERE l.status = 'active'
AND(tsq IS NULL OR l.search_vector @@tsq)
AND(p_category_id IS NULL OR l.category_id = p_category_id)
AND(p_min_price IS NULL OR l.price >= p_min_price)
AND(p_max_price IS NULL OR l.price <= p_max_price)
AND(p_location IS NULL OR l.location ILIKE '%' || p_location || '%')
AND(p_condition IS NULL OR l.condition = p_condition)
  ORDER BY
    CASE l.boost_type
      WHEN 'turbo'    THEN 4
      WHEN 'premium'  THEN 3
      WHEN 'featured' THEN 2
      ELSE 1
    END DESC,
    CASE WHEN tsq IS NOT NULL THEN ts_rank(l.search_vector, tsq) ELSE 0 END DESC,
        l.created_at DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

-- -------------------------------------------------------
    --Admin statisztikák
-- -------------------------------------------------------
    CREATE OR REPLACE FUNCTION get_admin_stats()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  result JSONB;
BEGIN
--Csak admin futtathatja
  IF NOT EXISTS(SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Nincs jogosultságod!';
  END IF;

  SELECT jsonb_build_object(
    'total_listings', (SELECT COUNT(*) FROM listings),
    'active_listings', (SELECT COUNT(*) FROM listings WHERE status = 'active'),
'sold_listings', (SELECT COUNT(*) FROM listings WHERE status = 'sold'),
'total_users', (SELECT COUNT(*) FROM profiles),
'banned_users', (SELECT COUNT(*) FROM profiles WHERE is_banned = TRUE),
'total_revenue', (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE status = 'paid'),
'pending_reports', (SELECT COUNT(*) FROM reports WHERE status = 'pending'),
'messages_today', (SELECT COUNT(*) FROM messages WHERE created_at > NOW() - INTERVAL '24 hours'),
'new_users_today', (SELECT COUNT(*) FROM profiles WHERE created_at > NOW() - INTERVAL '24 hours')
  ) INTO result;

  RETURN result;
END;
$$;

-- -------------------------------------------------------
    --Tiltott szó ellenőrzés hirdetés előtt
-- -------------------------------------------------------
    CREATE OR REPLACE FUNCTION check_banned_words()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  bad_word TEXT;
BEGIN
  FOR bad_word IN SELECT word FROM banned_words LOOP
    IF NEW.title ILIKE '%' || bad_word || '%' OR
NEW.description ILIKE '%' || bad_word || '%' THEN
      RAISE EXCEPTION 'A hirdetés tiltott kifejezést tartalmaz: %', bad_word;
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE TRIGGER listing_banned_words_check
  BEFORE INSERT OR UPDATE OF title, description
  ON listings
  FOR EACH ROW EXECUTE FUNCTION check_banned_words();

-- ============================================================
    --5. STORAGE BUCKET - EK
-- ============================================================

    INSERT INTO storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
VALUES
    ('avatars', 'avatars', true, 2097152, ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
    ('listing-images', 'listing-images', true, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT(id) DO NOTHING;

--Storage RLS
CREATE POLICY "avatars_public_read"
  ON storage.objects FOR SELECT
USING(bucket_id = 'avatars');

CREATE POLICY "avatars_own_upload"
  ON storage.objects FOR INSERT
  WITH CHECK(bucket_id = 'avatars' AND auth.uid():: text = (storage.foldername(name))[1]);

CREATE POLICY "avatars_own_update"
  ON storage.objects FOR UPDATE
USING(bucket_id = 'avatars' AND auth.uid():: text = (storage.foldername(name))[1]);

CREATE POLICY "avatars_own_delete"
  ON storage.objects FOR DELETE
USING(bucket_id = 'avatars' AND auth.uid():: text = (storage.foldername(name))[1]);

CREATE POLICY "listing_images_public_read"
  ON storage.objects FOR SELECT
USING(bucket_id = 'listing-images');

CREATE POLICY "listing_images_own_upload"
  ON storage.objects FOR INSERT
  WITH CHECK(bucket_id = 'listing-images' AND auth.uid():: text = (storage.foldername(name))[1]);

CREATE POLICY "listing_images_own_delete"
  ON storage.objects FOR DELETE
USING(bucket_id = 'listing-images' AND auth.uid():: text = (storage.foldername(name))[1]);

-- ============================================================
    --6. REALTIME ENGEDÉLYEZÉS
-- ============================================================

    ALTER PUBLICATION supabase_realtime ADD TABLE messages;
ALTER PUBLICATION supabase_realtime ADD TABLE message_threads;
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
ALTER PUBLICATION supabase_realtime ADD TABLE auction_bids;
ALTER PUBLICATION supabase_realtime ADD TABLE listings;

-- ============================================================
    --7. KATEGÓRIÁK ALAP ADATOK
-- ============================================================

    INSERT INTO categories(name, slug, icon, sort_order) VALUES
        ('Elektronika', 'elektronika', '📱', 1),
        ('Ruha & Divat', 'ruha-divat', '👗', 2),
        ('Járművek', 'jarmu', '🚗', 3),
        ('Ingatlan', 'ingatlan', '🏠', 4),
        ('Sport & Szabadidő', 'sport', '⚽', 5),
        ('Ház & Kert', 'haz-kert', '🛋', 6),
        ('Könyvek & Játékok', 'konyvek', '📚', 7),
        ('Gyerek', 'gyerek', '🧸', 8),
        ('Állatoknak', 'allatok', '🐾', 9),
        ('Munka & Szolgáltatás', 'munka', '💼', 10);

INSERT INTO categories(name, slug, icon, parent_id, sort_order) VALUES
--Elektronika alkategóriák
    ('Mobiltelefonok', 'mobil', '📱', 1, 1),
    ('Laptopok', 'laptop', '💻', 1, 2),
    ('Táblagépek', 'tablet', '📟', 1, 3),
    ('TV & Hangszórók', 'tv', '📺', 1, 4),
    ('Fényképezőgépek', 'fenykep', '📷', 1, 5),
    ('Konzolok & Játékok', 'konzol', '🎮', 1, 6),
    ('Számítógépek', 'szamitogep', '🖥️', 1, 7),
    --Ruha alkategóriák
        ('Női ruházat', 'noi-ruha', '👗', 2, 1),
        ('Férfi ruházat', 'ferfi-ruha', '👔', 2, 2),
        ('Cipők', 'cipok', '👟', 2, 3),
        ('Táskák & Kiegészítők', 'taskak', '👜', 2, 4),
        --Jármű alkategóriák
            ('Személyautók', 'szemelya', '🚗', 3, 1),
            ('Motorkerékpárok', 'motor', '🏍️', 3, 2),
            ('Kerékpárok', 'kerekpar', '🚲', 3, 3),
            ('Alkatrészek', 'alkatresz', '🔧', 3, 4),
            --Ingatlan alkategóriák
                ('Eladó lakások', 'elado-lakas', '🏢', 4, 1),
                ('Kiadó lakások', 'kiado-lakas', '🏘️', 4, 2),
                ('Eladó házak', 'elado-haz', '🏡', 4, 3),
                --Ház & Kert alkategóriák
                    ('Bútorok', 'butorok', '🛋', 6, 1),
                    ('Háztartási gépek', 'hzt-gepek', '🫙', 6, 2),
                    ('Kerti eszközök', 'kerti', '🌱', 6, 3);

-- ============================================================
    --8. TILTOTT SZAVAK(alap lista)
-- ============================================================

    INSERT INTO banned_words(word) VALUES
        ('spam'), ('scam'), ('casino'), ('szerencsejáték')
ON CONFLICT DO NOTHING;

-- ============================================================
    --KÉSZ! A Supabase backend production - ready állapotban van.
-- ============================================================
