import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Search, Send, Image as ImageIcon, MoreVertical, ArrowLeft, Lock, User, CheckCheck, Ban, UserPlus, Edit2, Trash2, Smile, MessageCircle } from 'lucide-react';

// =========================================================
// SUPABASE CONFIG — talks directly to Supabase's REST API
// (no SDK import needed, since artifacts can't import arbitrary npm packages)
// =========================================================
const SUPABASE_URL = 'https://rdansllssygmxitpmdoy.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJkYW5zbGxzc3lnbXhpdHBtZG95Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI0NTgyMzMsImV4cCI6MjA5ODAzNDIzM30.eaNhXC-Z9gGlRNOOzp7igj5mnSqpOCMgkxrafLCC5sI';

const REST_URL = `${SUPABASE_URL}/rest/v1`;

async function supaFetch(path, options = {}) {
  const res = await fetch(`${REST_URL}${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      Prefer: options.prefer || 'return=representation',
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    let detail = '';
    try {
      const body = await res.json();
      detail = body?.message || body?.error || JSON.stringify(body);
    } catch {
      detail = await res.text();
    }
    throw new Error(`${res.status}: ${detail || res.statusText}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// ---------- DB helper functions ----------
async function dbGetUserByUsername(username) {
  const rows = await supaFetch(`/users?username=eq.${encodeURIComponent(username)}&select=*&limit=1`);
  return rows && rows.length ? rows[0] : null;
}

async function dbGetUserByCode(code) {
  const rows = await supaFetch(`/users?code=eq.${encodeURIComponent(code)}&select=username,code&limit=1`);
  return rows && rows.length ? rows[0] : null;
}

async function dbCreateUser({ username, password, character, code }) {
  return supaFetch('/users', {
    method: 'POST',
    body: JSON.stringify({ username, password, character, code }),
  });
}

async function dbUpdatePassword(username, newPassword) {
  return supaFetch(`/users?username=eq.${encodeURIComponent(username)}`, {
    method: 'PATCH',
    body: JSON.stringify({ password: newPassword }),
  });
}

async function dbGetFriends(username) {
  const rows = await supaFetch(
    `/friendships?or=(user_a.eq.${encodeURIComponent(username)},user_b.eq.${encodeURIComponent(username)})&select=*`
  );
  return (rows || []).map((r) => (r.user_a === username ? r.user_b : r.user_a));
}

async function dbAddFriendship(userA, userB) {
  const [a, b] = [userA, userB].sort();
  return supaFetch('/friendships', {
    method: 'POST',
    body: JSON.stringify({ user_a: a, user_b: b }),
    prefer: 'return=representation,resolution=ignore-duplicates',
  });
}

async function dbGetBlocks(username) {
  const rows = await supaFetch(`/blocks?blocker=eq.${encodeURIComponent(username)}&select=blocked`);
  return (rows || []).map((r) => r.blocked);
}

async function dbAddBlock(blocker, blocked) {
  return supaFetch('/blocks', {
    method: 'POST',
    body: JSON.stringify({ blocker, blocked }),
    prefer: 'return=representation,resolution=ignore-duplicates',
  });
}

async function dbRemoveBlock(blocker, blocked) {
  return supaFetch(
    `/blocks?blocker=eq.${encodeURIComponent(blocker)}&blocked=eq.${encodeURIComponent(blocked)}`,
    { method: 'DELETE', prefer: 'return=minimal' }
  );
}

async function dbGetMessages(chatKey) {
  return supaFetch(`/messages?chat_key=eq.${encodeURIComponent(chatKey)}&select=*&order=created_at.asc`);
}

async function dbSendMessage({ chatKey, sender, type, content }) {
  return supaFetch('/messages', {
    method: 'POST',
    body: JSON.stringify({ chat_key: chatKey, sender, type, content }),
  });
}

async function dbEditMessage(id, content) {
  return supaFetch(`/messages?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ content, edited: true }),
  });
}

async function dbDeleteMessage(id) {
  return supaFetch(`/messages?id=eq.${encodeURIComponent(id)}`, {
    method: 'DELETE',
    prefer: 'return=minimal',
  });
}

// ---------- Local session helpers (just remembers who's logged in on this device) ----------
const SESSION_KEY = 'whattext_session';
function saveSession(username) {
  try {
    window.localStorage.setItem(SESSION_KEY, username);
  } catch {
    // ignore — session just won't persist across reloads
  }
}
function loadSession() {
  try {
    return window.localStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}
function clearSession() {
  try {
    window.localStorage.removeItem(SESSION_KEY);
  } catch {
    // ignore
  }
}

// ---------- Utility ----------
function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function timeNow(isoString) {
  const d = isoString ? new Date(isoString) : new Date();
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function normalizeAnswer(s) {
  return (s || '').trim().toLowerCase();
}

function chatKeyFor(a, b) {
  return [a, b].sort().join('__');
}

// =========================================================
// ROOT APP
// =========================================================

export default function WhatText() {
  const [booting, setBooting] = useState(true);
  const [screen, setScreen] = useState('login'); // login | register | forgot | app
  const [currentUser, setCurrentUser] = useState(null);
  const [toast, setToast] = useState(null);
  const [connStatus, setConnStatus] = useState('checking'); // checking | ok | broken
  const [connError, setConnError] = useState('');

  const showToast = useCallback((msg, type = 'info') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  // Connection self-test: confirm we can actually reach Supabase
  useEffect(() => {
    (async () => {
      try {
        await supaFetch('/users?select=username&limit=1');
        setConnStatus('ok');
      } catch (err) {
        console.error('Supabase connection test failed:', err);
        setConnStatus('broken');
        setConnError(err?.message || String(err));
      }
    })();
  }, []);

  // Boot: load session and verify the user still exists
  useEffect(() => {
    (async () => {
      const savedUsername = loadSession();
      if (savedUsername) {
        try {
          const user = await dbGetUserByUsername(savedUsername);
          if (user) {
            setCurrentUser(savedUsername);
            setScreen('app');
          } else {
            clearSession();
          }
        } catch (err) {
          console.error('Session check failed:', err);
        }
      }
      setBooting(false);
    })();
  }, []);

  if (booting) {
    return (
      <div className="w-full h-full min-h-screen flex items-center justify-center" style={{ background: '#0B141A' }}>
        <div className="flex flex-col items-center gap-3">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: '#00A884' }}>
            <MessageCircle size={32} color="#fff" />
          </div>
          <div style={{ color: '#8696A0', fontFamily: 'system-ui' }}>Loading WhatText…</div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-screen overflow-hidden" style={{ fontFamily: "'Segoe UI', system-ui, sans-serif" }}>
      {connStatus === 'broken' && (
        <div
          className="fixed top-0 left-0 right-0 z-50 px-4 py-2 text-xs"
          style={{ background: '#D32F2F', color: '#fff' }}
        >
          <b>Can't reach the server:</b> {connError}
        </div>
      )}
      {toast && (
        <div
          className="fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg shadow-lg text-sm font-medium max-w-[90%] text-center"
          style={{
            background: toast.type === 'error' ? '#D32F2F' : '#202C33',
            color: '#fff',
            border: '1px solid #2A3942',
          }}
        >
          {toast.msg}
        </div>
      )}

      {screen === 'login' && (
        <LoginScreen
          onSwitchRegister={() => setScreen('register')}
          onSwitchForgot={() => setScreen('forgot')}
          onLoggedIn={(uname) => {
            setCurrentUser(uname);
            setScreen('app');
          }}
          showToast={showToast}
        />
      )}
      {screen === 'register' && (
        <RegisterScreen onSwitchLogin={() => setScreen('login')} showToast={showToast} />
      )}
      {screen === 'forgot' && (
        <ForgotPasswordScreen onSwitchLogin={() => setScreen('login')} showToast={showToast} />
      )}
      {screen === 'app' && currentUser && (
        <MainApp
          username={currentUser}
          showToast={showToast}
          onLogout={() => {
            clearSession();
            setCurrentUser(null);
            setScreen('login');
          }}
        />
      )}
    </div>
  );
}

// =========================================================
// AUTH SCREENS
// =========================================================

function AuthShell({ children, subtitle }) {
  return (
    <div
      className="w-full h-screen flex flex-col items-center justify-center px-6"
      style={{ background: 'linear-gradient(180deg, #0B141A 0%, #111B21 100%)' }}
    >
      <div className="flex flex-col items-center mb-8">
        <div className="w-20 h-20 rounded-3xl flex items-center justify-center mb-4 shadow-lg" style={{ background: '#00A884' }}>
          <MessageCircle size={40} color="#fff" strokeWidth={2} />
        </div>
        <h1 className="text-3xl font-bold" style={{ color: '#E9EDEF', letterSpacing: '-0.02em' }}>
          What<span style={{ color: '#00A884' }}>Text</span>
        </h1>
        <p className="text-sm mt-1" style={{ color: '#8696A0' }}>{subtitle}</p>
      </div>
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}

function Field({ icon: Icon, ...props }) {
  return (
    <div className="relative mb-3">
      <Icon size={18} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: '#8696A0' }} />
      <input
        {...props}
        className="w-full pl-10 pr-4 py-3 rounded-xl outline-none text-sm transition-colors"
        style={{ background: '#202C33', color: '#E9EDEF', border: '1px solid #2A3942' }}
        onFocus={(e) => (e.target.style.border = '1px solid #00A884')}
        onBlur={(e) => (e.target.style.border = '1px solid #2A3942')}
      />
    </div>
  );
}

function PrimaryButton({ children, ...props }) {
  return (
    <button
      {...props}
      className="w-full py-3 rounded-xl font-semibold text-sm transition-transform active:scale-[0.98] disabled:opacity-50"
      style={{ background: '#00A884', color: '#fff' }}
    >
      {children}
    </button>
  );
}

function LoginScreen({ onSwitchRegister, onSwitchForgot, onLoggedIn, showToast }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!username.trim() || !password) {
      showToast('Please enter both username and password', 'error');
      return;
    }
    setLoading(true);
    try {
      const uname = username.trim().toLowerCase();
      const user = await dbGetUserByUsername(uname);
      if (!user) {
        showToast('This username is not registered', 'error');
        setLoading(false);
        return;
      }
      if (user.password !== password) {
        showToast('Incorrect password', 'error');
        setLoading(false);
        return;
      }
      saveSession(uname);
      showToast(`Welcome back, ${uname}!`, 'success');
      onLoggedIn(uname);
    } catch (err) {
      console.error('Login error:', err);
      showToast(`Login failed: ${err?.message || 'unknown error'}`, 'error');
    }
    setLoading(false);
  };

  return (
    <AuthShell subtitle="Secure chat, no phone number needed">
      <Field icon={User} placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleLogin()} />
      <Field icon={Lock} type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleLogin()} />
      <PrimaryButton onClick={handleLogin} disabled={loading}>
        {loading ? 'Logging in…' : 'Login'}
      </PrimaryButton>
      <div className="flex justify-between mt-4 text-sm">
        <button onClick={onSwitchForgot} style={{ color: '#00A884' }} className="font-medium">Forgot password?</button>
        <button onClick={onSwitchRegister} style={{ color: '#8696A0' }} className="font-medium">Create new account</button>
      </div>
    </AuthShell>
  );
}

function RegisterScreen({ onSwitchLogin, showToast }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [character, setCharacter] = useState('');
  const [loading, setLoading] = useState(false);

  const handleRegister = async () => {
    const uname = username.trim().toLowerCase();
    const char = character.trim();
    if (!uname || !password || !char) {
      showToast('Please fill in all fields', 'error');
      return;
    }
    if (uname.length < 3) {
      showToast('Username must be at least 3 characters', 'error');
      return;
    }
    if (!/^[a-z0-9_]+$/.test(uname)) {
      showToast('Username can only contain letters, numbers, and underscores', 'error');
      return;
    }
    if (password.length < 4) {
      showToast('Password must be at least 4 characters', 'error');
      return;
    }
    if (password !== confirmPassword) {
      showToast('Passwords do not match', 'error');
      return;
    }
    setLoading(true);
    try {
      const existing = await dbGetUserByUsername(uname);
      if (existing) {
        showToast('This username is already taken', 'error');
        setLoading(false);
        return;
      }

      let code;
      let tries = 0;
      let codeTaken = true;
      do {
        code = genCode();
        const owner = await dbGetUserByCode(code);
        codeTaken = !!owner;
        tries++;
      } while (codeTaken && tries < 20);

      if (codeTaken) {
        showToast('Could not generate a unique code, please try again', 'error');
        setLoading(false);
        return;
      }

      await dbCreateUser({ username: uname, password, character: char, code });
      showToast('Account created! Please log in', 'success');
      onSwitchLogin();
    } catch (err) {
      console.error('Registration error:', err);
      showToast(`Registration failed: ${err?.message || 'unknown error'}`, 'error');
    }
    setLoading(false);
  };

  return (
    <AuthShell subtitle="Create a new account">
      <Field icon={User} placeholder="Choose a username" value={username} onChange={(e) => setUsername(e.target.value)} />
      <Field icon={Lock} type="password" placeholder="Create a password" value={password} onChange={(e) => setPassword(e.target.value)} />
      <Field icon={Lock} type="password" placeholder="Re-enter password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
      <Field icon={Smile} placeholder="Your favourite character (e.g. Iron Man)" value={character} onChange={(e) => setCharacter(e.target.value)} />
      <p className="text-xs mb-4 -mt-1" style={{ color: '#8696A0' }}>
        You'll need to type this exactly if you ever forget your password.
      </p>
      <PrimaryButton onClick={handleRegister} disabled={loading}>
        {loading ? 'Creating account…' : 'Register'}
      </PrimaryButton>
      <div className="flex justify-center mt-4 text-sm">
        <button onClick={onSwitchLogin} style={{ color: '#00A884' }} className="font-medium">
          Already have an account? Login
        </button>
      </div>
    </AuthShell>
  );
}

function ForgotPasswordScreen({ onSwitchLogin, showToast }) {
  const [step, setStep] = useState(1);
  const [username, setUsername] = useState('');
  const [character, setCharacter] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNew, setConfirmNew] = useState('');
  const [loading, setLoading] = useState(false);
  const [userRecord, setUserRecord] = useState(null);

  const checkUser = async () => {
    const uname = username.trim().toLowerCase();
    if (!uname) {
      showToast('Please enter a username', 'error');
      return;
    }
    setLoading(true);
    try {
      const user = await dbGetUserByUsername(uname);
      if (!user) {
        showToast('This username is not registered', 'error');
        setLoading(false);
        return;
      }
      setUserRecord(user);
      setStep(2);
    } catch (err) {
      console.error(err);
      showToast(`Something went wrong: ${err?.message || 'unknown error'}`, 'error');
    }
    setLoading(false);
  };

  const verifyCharacter = () => {
    if (!character.trim()) {
      showToast('Please enter the character name', 'error');
      return;
    }
    if (normalizeAnswer(character) !== normalizeAnswer(userRecord.character)) {
      showToast("That doesn't match, try again", 'error');
      return;
    }
    setStep(3);
  };

  const resetPassword = async () => {
    if (newPassword.length < 4) {
      showToast('Password must be at least 4 characters', 'error');
      return;
    }
    if (newPassword !== confirmNew) {
      showToast('Passwords do not match', 'error');
      return;
    }
    setLoading(true);
    try {
      const uname = username.trim().toLowerCase();
      await dbUpdatePassword(uname, newPassword);
      showToast('Password reset! Please log in', 'success');
      onSwitchLogin();
    } catch (err) {
      console.error(err);
      showToast(`Could not reset password: ${err?.message || 'unknown error'}`, 'error');
    }
    setLoading(false);
  };

  return (
    <AuthShell subtitle="Reset your password">
      {step === 1 && (
        <>
          <Field icon={User} placeholder="Enter your username" value={username} onChange={(e) => setUsername(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && checkUser()} />
          <PrimaryButton onClick={checkUser} disabled={loading}>Next</PrimaryButton>
        </>
      )}
      {step === 2 && (
        <>
          <p className="text-sm mb-3" style={{ color: '#8696A0' }}>Enter the favourite character you gave when you registered:</p>
          <Field icon={Smile} placeholder="Character name" value={character} onChange={(e) => setCharacter(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && verifyCharacter()} />
          <PrimaryButton onClick={verifyCharacter}>Verify</PrimaryButton>
        </>
      )}
      {step === 3 && (
        <>
          <Field icon={Lock} type="password" placeholder="New password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          <Field icon={Lock} type="password" placeholder="Re-enter new password" value={confirmNew} onChange={(e) => setConfirmNew(e.target.value)} />
          <PrimaryButton onClick={resetPassword} disabled={loading}>
            {loading ? 'Resetting…' : 'Reset password'}
          </PrimaryButton>
        </>
      )}
      <div className="flex justify-center mt-4 text-sm">
        <button onClick={onSwitchLogin} style={{ color: '#00A884' }} className="font-medium">Back to login</button>
      </div>
    </AuthShell>
  );
}

// =========================================================
// MAIN APP
// =========================================================

function MainApp({ username, showToast, onLogout }) {
  const [myCode, setMyCode] = useState(null);
  const [friends, setFriends] = useState([]);
  const [blocked, setBlocked] = useState([]);
  const [activeChat, setActiveChat] = useState(null);
  const [view, setView] = useState('list'); // list | search | settings
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResult, setSearchResult] = useState(null);
  const [searching, setSearching] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const loadAll = useCallback(async () => {
    try {
      const me = await dbGetUserByUsername(username);
      if (me) setMyCode(me.code);
      const [friendList, blockList] = await Promise.all([dbGetFriends(username), dbGetBlocks(username)]);
      setFriends(friendList);
      setBlocked(blockList);
    } catch (err) {
      console.error('Failed to load profile data:', err);
      showToast(`Could not load your data: ${err?.message || 'unknown error'}`, 'error');
    }
    setLoaded(true);
  }, [username, showToast]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (view === 'list' && loaded) {
      dbGetFriends(username).then(setFriends).catch((e) => console.error(e));
      dbGetBlocks(username).then(setBlocked).catch((e) => console.error(e));
    }
  }, [view, username, loaded]);

  const handleSearch = async () => {
    const code = searchQuery.trim().toUpperCase();
    if (!code) return;
    setSearching(true);
    setSearchResult(null);
    try {
      const found = await dbGetUserByCode(code);
      if (!found) {
        setSearchResult({ notFound: true });
      } else if (found.username === username) {
        setSearchResult({ self: true });
      } else {
        setSearchResult({ username: found.username, code: found.code });
      }
    } catch (err) {
      console.error(err);
      showToast(`Search failed: ${err?.message || 'unknown error'}`, 'error');
    }
    setSearching(false);
  };

  const addFriend = async (friendUsername) => {
    if (friends.includes(friendUsername)) {
      showToast('Already in your friend list', 'info');
      return;
    }
    try {
      await dbAddFriendship(username, friendUsername);
      setFriends((prev) => [...prev, friendUsername]);
      showToast(`${friendUsername} added!`, 'success');
      setSearchResult(null);
      setSearchQuery('');
      setView('list');
    } catch (err) {
      console.error(err);
      showToast(`Could not add friend: ${err?.message || 'unknown error'}`, 'error');
    }
  };

  const toggleBlock = async (friendUsername) => {
    try {
      if (blocked.includes(friendUsername)) {
        await dbRemoveBlock(username, friendUsername);
        setBlocked((prev) => prev.filter((b) => b !== friendUsername));
        showToast(`${friendUsername} unblocked`, 'info');
      } else {
        await dbAddBlock(username, friendUsername);
        setBlocked((prev) => [...prev, friendUsername]);
        showToast(`${friendUsername} blocked`, 'info');
      }
    } catch (err) {
      console.error(err);
      showToast(`Action failed: ${err?.message || 'unknown error'}`, 'error');
    }
  };

  if (!loaded) {
    return (
      <div className="w-full h-screen flex items-center justify-center" style={{ background: '#0B141A' }}>
        <div style={{ color: '#8696A0' }}>Loading…</div>
      </div>
    );
  }

  if (activeChat) {
    return (
      <ChatScreen
        myUsername={username}
        friendUsername={activeChat}
        isBlocked={blocked.includes(activeChat)}
        onBack={() => setActiveChat(null)}
        onToggleBlock={() => toggleBlock(activeChat)}
        showToast={showToast}
      />
    );
  }

  return (
    <div className="w-full h-screen flex flex-col" style={{ background: '#0B141A' }}>
      <div className="flex items-center justify-between px-4 py-3 shrink-0" style={{ background: '#202C33' }}>
        <h1 className="text-lg font-semibold" style={{ color: '#E9EDEF' }}>WhatText</h1>
        <div className="flex items-center gap-4 relative">
          <button onClick={() => setView(view === 'search' ? 'list' : 'search')}>
            <Search size={20} color="#AEBAC1" />
          </button>
          <button onClick={() => setMenuOpen((o) => !o)}>
            <MoreVertical size={20} color="#AEBAC1" />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-8 w-44 rounded-lg shadow-xl z-20 overflow-hidden" style={{ background: '#233138' }}>
              <button onClick={() => { setMenuOpen(false); setView('settings'); }} className="w-full text-left px-4 py-3 text-sm" style={{ color: '#E9EDEF' }}>
                My code
              </button>
              <button onClick={() => { setMenuOpen(false); onLogout(); }} className="w-full text-left px-4 py-3 text-sm border-t" style={{ color: '#E9EDEF', borderColor: '#2A3942' }}>
                Logout
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="px-4 py-3 flex items-center justify-between shrink-0" style={{ background: '#111B21', borderBottom: '1px solid #202C33' }}>
        <div>
          <div className="text-xs" style={{ color: '#8696A0' }}>Your code</div>
          <div className="text-xl font-bold tracking-widest" style={{ color: '#00A884' }}>{myCode}</div>
        </div>
        <div className="text-xs text-right max-w-[140px]" style={{ color: '#8696A0' }}>
          Share this code with friends so they can search and add you
        </div>
      </div>

      {view === 'search' && (
        <div className="px-4 py-3 shrink-0" style={{ background: '#111B21' }}>
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: '#8696A0' }} />
              <input
                autoFocus
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                placeholder="Enter a 6-letter code"
                maxLength={6}
                className="w-full pl-9 pr-3 py-2 rounded-lg outline-none text-sm tracking-widest"
                style={{ background: '#202C33', color: '#E9EDEF', border: '1px solid #2A3942' }}
              />
            </div>
            <button onClick={handleSearch} className="px-4 rounded-lg text-sm font-medium" style={{ background: '#00A884', color: '#fff' }}>
              {searching ? '...' : 'Search'}
            </button>
          </div>

          {searchResult && (
            <div className="mt-3 p-3 rounded-lg flex items-center justify-between" style={{ background: '#202C33' }}>
              {searchResult.notFound && <span style={{ color: '#8696A0' }} className="text-sm">No user found with that code</span>}
              {searchResult.self && <span style={{ color: '#8696A0' }} className="text-sm">That's your own code!</span>}
              {searchResult.username && (
                <>
                  <div className="flex items-center gap-3">
                    <Avatar name={searchResult.username} />
                    <span className="text-sm font-medium" style={{ color: '#E9EDEF' }}>{searchResult.username}</span>
                  </div>
                  <button onClick={() => addFriend(searchResult.username)} className="flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium" style={{ background: '#00A884', color: '#fff' }}>
                    <UserPlus size={14} /> Add
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {view === 'settings' && (
        <div className="px-4 py-3 shrink-0 flex items-center justify-between" style={{ background: '#111B21' }}>
          <span className="text-sm" style={{ color: '#8696A0' }}>Logged in as <b style={{ color: '#E9EDEF' }}>{username}</b></span>
          <button onClick={() => setView('list')} style={{ color: '#00A884' }} className="text-sm font-medium">Close</button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {friends.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full px-8 text-center">
            <UserPlus size={40} style={{ color: '#2A3942' }} className="mb-3" />
            <p className="text-sm" style={{ color: '#8696A0' }}>
              No friends yet. Tap the search icon and enter a 6-letter code to add someone.
            </p>
          </div>
        ) : (
          friends.map((f) => (
            <button
              key={f}
              onClick={() => setActiveChat(f)}
              className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors"
              style={{ borderBottom: '1px solid #1A2329' }}
            >
              <Avatar name={f} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm" style={{ color: '#E9EDEF' }}>{f}</span>
                  {blocked.includes(f) && <Ban size={14} style={{ color: '#F15C6D' }} />}
                </div>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function Avatar({ name }) {
  const colors = ['#00A884', '#6B8AFF', '#F5A623', '#E85C5C', '#9B59B6', '#1ABC9C'];
  const idx = name.charCodeAt(0) % colors.length;
  return (
    <div className="w-12 h-12 rounded-full flex items-center justify-center text-white font-semibold shrink-0" style={{ background: colors[idx] }}>
      {name[0].toUpperCase()}
    </div>
  );
}

// =========================================================
// CHAT SCREEN
// =========================================================

function ChatScreen({ myUsername, friendUsername, isBlocked, onBack, onToggleBlock, showToast }) {
  const chatKey = chatKeyFor(myUsername, friendUsername);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState('');
  const [menuFor, setMenuFor] = useState(null);
  const [headerMenu, setHeaderMenu] = useState(false);
  const scrollRef = useRef(null);
  const fileInputRef = useRef(null);
  const pollRef = useRef(null);

  const fetchMessages = useCallback(async () => {
    try {
      const rows = await dbGetMessages(chatKey);
      setMessages(rows || []);
    } catch (err) {
      console.error('Failed to load messages:', err);
    }
  }, [chatKey]);

  useEffect(() => {
    (async () => {
      await fetchMessages();
      setLoaded(true);
    })();
    pollRef.current = setInterval(fetchMessages, 3000);
    return () => clearInterval(pollRef.current);
  }, [fetchMessages]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const sendMessage = async (content, type = 'text') => {
    if (isBlocked) {
      showToast('You have blocked this person, unblock to send messages', 'error');
      return;
    }
    setInput('');
    try {
      const created = await dbSendMessage({ chatKey, sender: myUsername, type, content });
      if (created && created[0]) {
        setMessages((prev) => [...prev, created[0]]);
      } else {
        await fetchMessages();
      }
    } catch (err) {
      console.error(err);
      showToast(`Could not send: ${err?.message || 'unknown error'}`, 'error');
    }
  };

  const handleSend = () => {
    if (!input.trim()) return;
    sendMessage(input.trim(), 'text');
  };

  const handleImagePick = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 1.5 * 1024 * 1024) {
      showToast('Image is too large (max 1.5MB for now)', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      sendMessage(reader.result, 'image');
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const startEdit = (msg) => {
    setEditingId(msg.id);
    setEditText(msg.content);
    setMenuFor(null);
  };

  const saveEdit = async () => {
    if (!editText.trim()) return;
    const id = editingId;
    const newContent = editText.trim();
    setEditingId(null);
    setEditText('');
    try {
      await dbEditMessage(id, newContent);
      setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, content: newContent, edited: true } : m)));
    } catch (err) {
      console.error(err);
      showToast(`Could not save edit: ${err?.message || 'unknown error'}`, 'error');
    }
  };

  const deleteMessage = async (id) => {
    setMenuFor(null);
    try {
      await dbDeleteMessage(id);
      setMessages((prev) => prev.filter((m) => m.id !== id));
    } catch (err) {
      console.error(err);
      showToast(`Could not delete: ${err?.message || 'unknown error'}`, 'error');
    }
  };

  if (!loaded) {
    return <div className="w-full h-screen flex items-center justify-center" style={{ background: '#0B141A', color: '#8696A0' }}>Loading chat…</div>;
  }

  return (
    <div className="w-full h-screen flex flex-col" style={{ background: '#0B141A' }}>
      <div className="flex items-center gap-3 px-3 py-2.5 shrink-0 relative" style={{ background: '#202C33' }}>
        <button onClick={onBack}><ArrowLeft size={20} color="#AEBAC1" /></button>
        <Avatar name={friendUsername} />
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm" style={{ color: '#E9EDEF' }}>{friendUsername}</div>
          {isBlocked && <div className="text-xs" style={{ color: '#F15C6D' }}>Blocked</div>}
        </div>
        <button onClick={() => setHeaderMenu((o) => !o)}><MoreVertical size={20} color="#AEBAC1" /></button>
        {headerMenu && (
          <div className="absolute right-2 top-12 w-48 rounded-lg shadow-xl z-20 overflow-hidden" style={{ background: '#233138' }}>
            <button onClick={() => { onToggleBlock(); setHeaderMenu(false); }} className="w-full flex items-center gap-2 text-left px-4 py-3 text-sm" style={{ color: isBlocked ? '#00A884' : '#F15C6D' }}>
              <Ban size={15} /> {isBlocked ? 'Unblock' : 'Block'}
            </button>
          </div>
        )}
      </div>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-3 py-3 space-y-1"
        style={{
          backgroundColor: '#0B141A',
          backgroundImage: 'radial-gradient(circle at 20px 20px, #131C22 2px, transparent 0)',
          backgroundSize: '40px 40px',
        }}
      >
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center px-8">
            <p className="text-sm" style={{ color: '#8696A0' }}>No messages yet. Say hello to {friendUsername}!</p>
          </div>
        )}
        {messages.map((m) => {
          const mine = m.sender === myUsername;
          return (
            <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'} group relative`}>
              <div className="max-w-[75%] rounded-lg px-3 py-2 relative" style={{ background: mine ? '#005C4B' : '#202C33', color: '#E9EDEF' }}>
                {editingId === m.id ? (
                  <div className="flex flex-col gap-2 min-w-[180px]">
                    <input
                      autoFocus
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && saveEdit()}
                      className="px-2 py-1 rounded text-sm outline-none"
                      style={{ background: '#111B21', color: '#E9EDEF', border: '1px solid #00A884' }}
                    />
                    <div className="flex gap-2 justify-end">
                      <button onClick={() => setEditingId(null)} className="text-xs" style={{ color: '#8696A0' }}>Cancel</button>
                      <button onClick={saveEdit} className="text-xs font-medium" style={{ color: '#00A884' }}>Save</button>
                    </div>
                  </div>
                ) : (
                  <>
                    {m.type === 'image' ? (
                      <img src={m.content} alt="shared" className="rounded-md max-w-full max-h-64 object-cover mb-1" />
                    ) : (
                      <div className="text-sm whitespace-pre-wrap break-words pr-10">{m.content}</div>
                    )}
                    <div className="flex items-center justify-end gap-1 mt-0.5">
                      {m.edited && <span className="text-[10px]" style={{ color: '#8696A0' }}>edited</span>}
                      <span className="text-[10px]" style={{ color: '#8696A0' }}>{timeNow(m.created_at)}</span>
                      {mine && <CheckCheck size={13} style={{ color: '#53BDEB' }} />}
                    </div>
                  </>
                )}

                {mine && editingId !== m.id && (
                  <button onClick={() => setMenuFor(menuFor === m.id ? null : m.id)} className="absolute -top-1 -left-7 opacity-0 group-hover:opacity-100 transition-opacity p-1">
                    <MoreVertical size={14} color="#8696A0" />
                  </button>
                )}

                {menuFor === m.id && (
                  <div className="absolute z-10 top-0 right-full mr-1 w-32 rounded-lg shadow-xl overflow-hidden" style={{ background: '#233138' }}>
                    {m.type === 'text' && (
                      <button onClick={() => startEdit(m)} className="w-full flex items-center gap-2 text-left px-3 py-2 text-xs" style={{ color: '#E9EDEF' }}>
                        <Edit2 size={12} /> Edit
                      </button>
                    )}
                    <button onClick={() => deleteMessage(m.id)} className="w-full flex items-center gap-2 text-left px-3 py-2 text-xs" style={{ color: '#F15C6D' }}>
                      <Trash2 size={12} /> Delete
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-2 px-3 py-2.5 shrink-0" style={{ background: '#202C33' }}>
        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImagePick} />
        <button onClick={() => fileInputRef.current?.click()} disabled={isBlocked}>
          <ImageIcon size={22} color={isBlocked ? '#3B4A54' : '#AEBAC1'} />
        </button>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          disabled={isBlocked}
          placeholder={isBlocked ? 'Unblock to send a message' : 'Type a message'}
          className="flex-1 px-4 py-2.5 rounded-full outline-none text-sm disabled:opacity-50"
          style={{ background: '#2A3942', color: '#E9EDEF' }}
        />
        <button
          onClick={handleSend}
          disabled={isBlocked || !input.trim()}
          className="w-10 h-10 rounded-full flex items-center justify-center disabled:opacity-40 shrink-0"
          style={{ background: '#00A884' }}
        >
          <Send size={16} color="#fff" />
        </button>
      </div>
    </div>
  );
}
