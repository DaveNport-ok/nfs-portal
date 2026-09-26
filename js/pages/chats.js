import { _supabase } from '../config.js';
import '../widgets.js';
import '../global.js';

let currentUserId = null;
let myName = "";
let myProfile = null;

// Текущий активный чат (по умолчанию — общий канал)
let currentChat = {
  id: 'global',
  title: 'GENERAL CHANNEL',
  type: 'public' // 'public' | 'private'
};

let specialUsers = {};
let selectedFile = null;
let isSending = false;
let messagesSubscription = null;
let dmsSubscription = null;

window.onload = async () => {
  const { data: { user } } = await _supabase.auth.getUser();

  if (user) {
    // 1. АВТОРИЗОВАННЫЙ ГОНЩИК
    currentUserId = user.id;
    window.currentUserId = user.id;

    const { data: prof } = await _supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    if (prof) {
      prof.isGuest = false;
      myName = prof.username;
      myProfile = prof;
      window.myProfile = prof;

      const displayNick = document.getElementById('displayNick');
      if (displayNick) displayNick.textContent = myName;

      if (typeof initGlobalStatus === 'function') initGlobalStatus(_supabase, prof);
      if (typeof updateFriendNotifications === 'function') updateFriendNotifications();
      if (typeof updateGlobalMsgBadge === 'function') updateGlobalMsgBadge(_supabase, prof.id);
      if (typeof checkAdminReplies === 'function') checkAdminReplies();
    }
  } else {
    // 2. ГОСТЕВОЙ РЕЖИМ
    currentUserId = null;
    window.currentUserId = null;
    myName = "";
    myProfile = {
      id: null,
      username: 'Guest_' + Math.random().toString(36).substring(2, 6),
      isGuest: true,
      status: 'GUEST',
      avatar_url: 'https://via.placeholder.com/34?text=G'
    };
    window.myProfile = myProfile;

    const loginBtn = document.getElementById('loginBtn');
    const userInfo = document.getElementById('userInfo');
    if (loginBtn) loginBtn.style.display = 'block';
    if (userInfo) userInfo.style.display = 'none';

    if (typeof initGlobalStatus === 'function') initGlobalStatus(_supabase, null);

    // Блокируем поля ввода чата для гостя
    lockChatInputsForGuest();
  }

  // Загружаем список ролей и список диалогов
  await fetchSpecialRoles();
  await loadRecentDMs();

  // ПРОВЕРКА ПЕРЕХОДА ИЗ ПРОФИЛЯ ПО ССЫЛКЕ (?to=username)
  const urlParams = new URLSearchParams(window.location.search);
  const targetRacerName = urlParams.get('to');

  if (targetRacerName && !myProfile?.isGuest) {
    await openChatWithRacer(targetRacerName);
  } else {
    await loadMessages();
  }

  // Запуск подписок на новые сообщения в реальном времени
  initRealtime();
};

/**
 * Блокировка полей ввода для неавторизованных гостей
 */
function lockChatInputsForGuest() {
  const chatInput = document.getElementById('chatInput');
  const sendBtn = document.querySelector('.send-btn');
  const attachBtn = document.getElementById('attachBtn');

  if (chatInput) {
    chatInput.disabled = true;
    chatInput.placeholder = 'Radio transmitter locked. Log in to broadcast...';
    chatInput.style.backgroundColor = '#111';
    chatInput.style.cursor = 'not-allowed';
  }

  if (sendBtn) {
    sendBtn.disabled = true;
    sendBtn.style.opacity = '0.5';
    sendBtn.style.cursor = 'not-allowed';
    sendBtn.title = 'Authorization required';
  }

  if (attachBtn) {
    attachBtn.style.pointerEvents = 'none';
    attachBtn.style.opacity = '0.3';
  }
}

/**
 * Получение профилей для отображения аватарок и ролей
 */
async function fetchSpecialRoles() {
  const { data } = await _supabase.from('profiles').select('id, username, is_admin, is_vip, avatar_url, status');
  if (data) {
    data.forEach(u => {
      specialUsers[u.username.toLowerCase()] = {
        id: u.id,
        admin: u.is_admin,
        vip: u.is_vip,
        avatar: u.avatar_url,
        status: u.status || 'OFFLINE',
        username: u.username
      };
    });
  }
}

/**
 * Открытие персонального диалога по никнейму из URL (?to=...)
 */
async function openChatWithRacer(username) {
  const cleanName = username.trim();
  let racer = specialUsers[cleanName.toLowerCase()];

  if (!racer) {
    const { data } = await _supabase
      .from('profiles')
      .select('id, username')
      .ilike('username', cleanName)
      .maybeSingle();

    if (data) racer = data;
  }

  if (racer && racer.id !== currentUserId) {
    await switchChat(racer.id, racer.username, 'private');
  } else {
    await loadMessages();
  }
}

/**
 * Переключение чата (Общий или Личные сообщения)
 */
window.switchChat = async (targetId, title, type) => {
  if (type === 'private' && (!myProfile || myProfile.isGuest)) {
    if (typeof window.requireAuth === 'function') {
      window.requireAuth(null, "Log in to access private frequencies.");
    }
    return;
  }

  currentChat = { id: targetId, title, type };

  // Обновляем шапку текущего чата
  const titleEl = document.getElementById('chatWithTitle');
  const statusEl = document.getElementById('chatStatus');
  if (titleEl) {
    titleEl.innerHTML = `<span class="back-to-chats-btn" onclick="closeMobileChat(event)">&larr; </span>${title}`;
  }
  if (statusEl) {
    statusEl.textContent = type === 'public' ? 'PUBLIC FREQUENCY' : 'SECURE P2P LINK';
  }

  // Переключение активного класса в боковом списке
  document.querySelectorAll('.chat-item').forEach(el => el.classList.remove('active'));
  if (type === 'public') {
    document.getElementById('publicChatBtn')?.classList.add('active');
  } else {
    document.getElementById(`chat-${targetId}`)?.classList.add('active');
    // Помечаем входящие сообщения как прочитанные
    if (currentUserId) {
      await _supabase.from('direct_messages')
        .update({ is_read: true })
        .eq('sender_id', targetId)
        .eq('receiver_id', currentUserId);
    }
  }

  // Открытие шторки на мобильных экранах
  document.querySelector('.app-container')?.classList.add('mobile-chat-open');

  await loadMessages();
  if (!myProfile?.isGuest) {
    await loadRecentDMs();
    if (typeof updateGlobalMsgBadge === 'function') updateGlobalMsgBadge(_supabase, currentUserId);
  }
};

window.closeMobileChat = (e) => {
  if (e) e.stopPropagation();
  document.querySelector('.app-container')?.classList.remove('mobile-chat-open');
};

/**
 * Загрузка бокового списка личных диалогов (Recent DMs)
 */
async function loadRecentDMs() {
  const container = document.getElementById('dmListContainer');
  if (!container) return;

  if (!myProfile || myProfile.isGuest) {
    container.innerHTML = `
      <div style="padding: 25px 15px; text-align: center; color: #666; font-size: 0.75rem;">
        <div style="color: #cca609; font-weight: bold; margin-bottom: 8px;">PRIVATE FREQUENCY</div>
        <div style="font-family: Arial, sans-serif !important; font-size: 0.8rem; line-height: 1.4; color: #888;">
          Direct messages are available to registered drivers only.
        </div>
        <a href="auth.html" style="color: var(--nfs-yellow, #f1c40f); font-weight: bold; text-decoration: none; display: inline-block; margin-top: 10px;">LOG IN</a>
      </div>
    `;
    return;
  }

  try {
    const { data, error } = await _supabase.from('direct_messages')
      .select('*')
      .or(`sender_id.eq.${currentUserId},receiver_id.eq.${currentUserId}`)
      .order('created_at', { ascending: false });

    if (error) throw error;

    const contacts = new Map();
    if (data) {
      data.forEach(m => {
        const otherId = (m.sender_id === currentUserId) ? m.receiver_id : m.sender_id;
        const otherName = (m.sender_id === currentUserId) ? m.receiver_name : m.sender_name;

        if (otherId && otherId !== currentUserId) {
          if (!contacts.has(otherId)) {
            const uData = specialUsers[otherName?.toLowerCase()] || { avatar: null };
            contacts.set(otherId, {
              id: otherId,
              name: otherName,
              avatar: uData.avatar,
              lastMsg: m.text || '📎 Attachment',
              unreadCount: 0
            });
          }
          if (m.receiver_id === currentUserId && m.is_read === false) {
            if (currentChat.type !== 'private' || String(currentChat.id) !== String(m.sender_id)) {
              contacts.get(otherId).unreadCount++;
            }
          }
        }
      });
    }

    container.innerHTML = contacts.size > 0 ? '' : '<p style="padding: 20px; font-size: 0.8rem; color: #444; font-style: italic;">No active conversations</p>';

    contacts.forEach((val, id) => {
      const active = currentChat.type === 'private' && String(currentChat.id) === String(id);
      const isOnline = Boolean(typeof onlineUsers !== 'undefined' && onlineUsers[val.name]);
      const borderColor = isOnline ? '#2ecc71' : '#555';

      container.innerHTML += `
        <div id="chat-${id}" class="chat-item ${active ? 'active' : ''}" onclick="switchChat('${id}', '${val.name}', 'private')">
          <div class="avatar-wrapper">
            <div class="chat-avatar" style="border: 2px solid ${borderColor};">
              ${val.avatar ? `<img src="${val.avatar}">` : `<div style="color: #fff; font-weight: bold;">${val.name ? val.name[0].toUpperCase() : 'U'}</div>`}
            </div>
          </div>
          <div class="chat-item-info">
            <div style="font-weight: bold; color: #ffffff">${val.name}</div>
            <div class="chat-item-preview-text" style="color: #888; font-size: 0.75rem;">${val.lastMsg ? val.lastMsg.substring(0, 22) : ''}</div>
          </div>
          ${val.unreadCount > 0 ? `<div class="unread-badge">${val.unreadCount}</div>` : ''}
        </div>
      `;
    });
  } catch (err) {
    console.error("Error loading DMs:", err);
  }
}

/**
 * Загрузка сообщений активного чата
 */
async function loadMessages() {
  const box = document.getElementById('msgBox');
  if (!box) return;

  // Гарантируем вертикальный flex-поток для корректного разделения право/лево
  box.style.display = 'flex';
  box.style.flexDirection = 'column';

  box.innerHTML = '<div style="color: #555; text-align: center; padding: 25px; font-family: monospace;">TUNING FREQUENCY...</div>';

  let data = null;
  let error = null;

  if (currentChat.type === 'public') {
    const res = await _supabase
      .from('messages')
      .select('*')
      .eq('room_id', 'global')
      .order('created_at', { ascending: true })
      .limit(100);
    data = res.data;
    error = res.error;
  } else {
    const res = await _supabase
      .from('direct_messages')
      .select('*')
      .or(`and(sender_id.eq.${currentUserId},receiver_id.eq.${currentChat.id}),and(sender_id.eq.${currentChat.id},receiver_id.eq.${currentUserId})`)
      .order('created_at', { ascending: true })
      .limit(100);
    data = res.data;
    error = res.error;
  }

  if (error) {
    console.error('Fetch error:', error);
    box.innerHTML = '<div style="color: #ff4757; text-align: center; padding: 20px;">Connection failed.</div>';
    return;
  }

  box.innerHTML = '';

  if (!data || data.length === 0) {
    box.innerHTML = '<div style="color: #444; font-style: italic; text-align: center; margin-top: 40px; font-family: sans-serif;">Frequency is clear. No messages yet...</div>';
    return;
  }

  data.forEach(m => renderMessage(m, false));
  scrollBottom();
}

/**
 * Рендеринг одного сообщения (Свои — справа, чужие — слева)
 */
function renderMessage(m, shouldScroll = true) {
  const box = document.getElementById('msgBox');
  if (!box) return;

  const existing = document.getElementById(`msg-${m.id}`);
  if (existing) {
    const textEl = existing.querySelector('.msg-text');
    if (textEl) textEl.textContent = m.text || '';
    return;
  }

  const dateObj = new Date(m.created_at);
  const msgDate = dateObj.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  const isMine = currentUserId && (m.sender_id === currentUserId || (myName && m.sender_name?.toLowerCase() === myName.toLowerCase()));
  const canManage = isMine || Boolean(window.myProfile?.is_admin);

  const actionButtonsHTML = canManage ? `
    <span style="display: inline-flex; align-items: center; gap: 6px; margin-left: 8px;">
      <span
        onclick="editMessage('${m.id}')"
        title="Edit message"
        style="color: #666; cursor: pointer; font-size: 0.8rem; font-weight: bold; transition: color 0.2s;"
        onmouseover="this.style.color='var(--nfs-yellow, #f1c40f)'"
        onmouseout="this.style.color='#666'">
        [✎]
      </span>
      <span
        onclick="deleteMessage('${m.id}')"
        title="Delete message"
        style="color: #666; cursor: pointer; font-size: 0.8rem; font-weight: bold; transition: color 0.2s;"
        onmouseover="this.style.color='#ff4757'"
        onmouseout="this.style.color='#666'">
        [✕]
      </span>
    </span>
  ` : '';

  const fileHTML = m.file_url ? `
    <div style="margin-top: 8px;">
      <img src="${m.file_url}" alt="Attachment" style="max-width: 100%; max-height: 220px; border-radius: 4px; border: 1px solid #333; cursor: zoom-in;" onclick="window.open('${m.file_url}', '_blank')">
    </div>
  ` : '';

  const uData = specialUsers[m.sender_name?.toLowerCase()] || { admin: false, avatar: null };

  // Цветовой стиль: золотистый для своих, графитовый для чужих
  const bubbleStyle = isMine
    ? `
      background: rgba(241, 196, 15, 0.08);
      border: 1px solid rgba(241, 196, 15, 0.3);
      border-right: 3px solid var(--nfs-yellow, #f1c40f);
      border-radius: 6px 2px 2px 6px;
    `
    : `
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-left: 3px solid #555;
      border-radius: 2px 6px 6px 2px;
    `;

  const msgHTML = `
    <div class="chat-msg-wrapper ${isMine ? 'outgoing-wrapper' : 'incoming-wrapper'}" style="display: flex; width: 100%; justify-content: ${isMine ? 'flex-end' : 'flex-start'}; margin-bottom: 12px;">
      <div class="chat-msg-row ${isMine ? 'outgoing' : 'incoming'}" id="msg-${m.id}" style="max-width: 82%; width: fit-content; min-width: 180px; padding: 10px 14px; box-sizing: border-box; backdrop-filter: blur(4px); ${bubbleStyle}">
        <div style="display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 5px;">
          <span style="display: inline-flex; align-items: center; gap: 6px;">
            <span class="racer-link ${uData.admin ? 'admin-glow' : ''}" style="color: var(--nfs-yellow, #f1c40f); font-weight: bold; cursor: pointer; font-size: 0.85rem; font-family: 'Wallpoet', Arial, sans-serif;" onclick="window.location.href='profile.html?u=${encodeURIComponent(m.sender_name)}'">
              ${m.sender_name} ${isMine ? '<small style="color: #888; font-size: 0.65rem;">(YOU)</small>' : ''}
            </span>
            ${uData.admin ? '<span class="badge-admin" style="font-size: 0.6rem; background: #e74c3c; color: #fff; padding: 1px 4px; font-weight: bold; border-radius: 2px;">ADM</span>' : ''}
          </span>
          <span style="display: inline-flex; align-items: center;">
            <span style="color: #666; font-size: 0.72rem; font-family: sans-serif;">${msgDate}</span>
            ${actionButtonsHTML}
          </span>
        </div>
        <div class="msg-text user-text-content" id="msg-text-${m.id}" style="color: #e0e0e0; white-space: pre-wrap; word-break: break-word; overflow-wrap: anywhere; font-family: Arial, sans-serif; font-size: 0.9rem; line-height: 1.45;">${m.text || ''}</div>
        ${fileHTML}
      </div>
    </div>
  `;

  box.insertAdjacentHTML('beforeend', msgHTML);

  if (shouldScroll) {
    scrollBottom();
  }
}

/**
 * Отправка сообщения
 */
window.doSendMessage = async () => {
  if (!currentUserId || window.myProfile?.isGuest) {
    if (typeof window.requireAuth === 'function') {
      window.requireAuth(null, "Log in to broadcast messages in chat.");
    } else {
      alert("Log in to send messages.");
    }
    return;
  }

  if (isSending) return;

  if (myProfile?.muted_until && new Date(myProfile.muted_until) > new Date()) {
    if (typeof Swal !== 'undefined') {
      Swal.fire({
        title: 'RADIO MUTED',
        text: 'Your transmitter is blocked by administration.',
        icon: 'error',
        customClass: { popup: 'nfs-crt-modal' }
      });
    } else {
      alert('You are muted.');
    }
    return;
  }

  const input = document.getElementById('chatInput');
  const text = input ? input.value.trim() : '';

  if (!text && !selectedFile) return;

  isSending = true;
  const sendBtn = document.querySelector('.send-btn');
  if (sendBtn) {
    sendBtn.disabled = true;
    sendBtn.innerText = 'TRANSMITTING...';
  }

  let fileUrl = null;

  try {
    if (selectedFile) {
      fileUrl = await uploadAttachment(selectedFile);
    }

    if (currentChat.type === 'public') {
      const { data, error } = await _supabase.from('messages').insert([{
        room_id: 'global',
        sender_id: currentUserId,
        sender_name: myName,
        text: text,
        file_url: fileUrl
      }]).select();

      if (error) throw error;
      if (data && data[0]) renderMessage(data[0], true);
    } else {
      const { data, error } = await _supabase.from('direct_messages').insert([{
        sender_id: currentUserId,
        sender_name: myName,
        receiver_id: currentChat.id,
        receiver_name: currentChat.title,
        text: text,
        file_url: fileUrl
      }]).select();

      if (error) throw error;
      if (data && data[0]) renderMessage(data[0], true);
      await loadRecentDMs();
    }

    if (input) input.value = '';
    selectedFile = null;
    const attachBtn = document.getElementById('attachBtn');
    if (attachBtn) {
      attachBtn.innerText = '📎';
      attachBtn.style.background = '';
      attachBtn.style.color = '';
    }
  } catch (err) {
    console.error('Send error:', err);
    if (typeof Swal !== 'undefined') {
      Swal.fire({
        title: 'ERROR',
        text: 'Failed to transmit message: ' + err.message,
        icon: 'error',
        customClass: { popup: 'nfs-crt-modal' }
      });
    }
  } finally {
    isSending = false;
    if (sendBtn) {
      sendBtn.disabled = false;
      sendBtn.innerText = 'ENTER';
    }
  }
};

/**
 * Загрузка файлов в Storage
 */
async function uploadAttachment(file) {
  const fileExt = file.name.split('.').pop() || 'png';
  const fileName = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}.${fileExt.toLowerCase()}`;
  const filePath = `${currentUserId}/${fileName}`;

  const { error } = await _supabase.storage
    .from('chat-attachments')
    .upload(filePath, file);

  if (error) throw error;

  const { data } = _supabase.storage
    .from('chat-attachments')
    .getPublicUrl(filePath);

  return data.publicUrl;
}

window.handleFileSelected = (e) => {
  if (myProfile?.isGuest) {
    if (typeof window.requireAuth === 'function') {
      window.requireAuth(null, "Log in to send attachments.");
    }
    e.target.value = '';
    return;
  }

  const file = e.target.files[0];
  if (!file) return;

  if (file.size > 25 * 1024 * 1024) {
    alert("File exceeds 25 MB limit!");
    e.target.value = '';
    return;
  }

  selectedFile = file;
  const attachBtn = document.getElementById('attachBtn');
  if (attachBtn) {
    attachBtn.innerText = '✅';
    attachBtn.style.background = 'var(--nfs-yellow, #f1c40f)';
    attachBtn.style.color = '#000';
  }
};

/**
 * Редактирование сообщения
 */
window.editMessage = async (msgId) => {
  if (!currentUserId || window.myProfile?.isGuest) return;

  const table = currentChat.type === 'public' ? 'messages' : 'direct_messages';
  const { data: msg, error } = await _supabase
    .from(table)
    .select('text')
    .eq('id', msgId)
    .single();

  if (error || !msg) return;

  const { value: newText } = await Swal.fire({
    title: 'EDIT MESSAGE',
    input: 'textarea',
    inputValue: msg.text,
    showCancelButton: true,
    confirmButtonText: 'SAVE',
    cancelButtonText: 'CANCEL',
    background: '#0a0a0a',
    color: '#fff',
    customClass: { popup: 'nfs-crt-modal' },
    inputValidator: (val) => (!val || !val.trim() ? 'Message text cannot be empty!' : null)
  });

  if (!newText || newText.trim() === msg.text) return;

  const { error: updateErr } = await _supabase
    .from(table)
    .update({ text: newText.trim() })
    .eq('id', msgId);

  if (updateErr) {
    Swal.fire({
      title: 'ERROR',
      text: updateErr.message,
      icon: 'error',
      customClass: { popup: 'nfs-crt-modal' }
    });
    return;
  }

  const textEl = document.getElementById(`msg-text-${msgId}`);
  if (textEl) textEl.textContent = newText.trim();
};

/**
 * Удаление сообщения
 */
window.deleteMessage = async (msgId) => {
  if (!currentUserId || window.myProfile?.isGuest) return;

  const result = await Swal.fire({
    title: 'DELETE MESSAGE?',
    text: 'This transmission will be permanently erased.',
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#ff4757',
    cancelButtonColor: '#222',
    confirmButtonText: 'YES, DELETE',
    cancelButtonText: 'CANCEL',
    background: '#0a0a0a',
    color: '#fff',
    customClass: { popup: 'nfs-crt-modal' }
  });

  if (!result.isConfirmed) return;

  const table = currentChat.type === 'public' ? 'messages' : 'direct_messages';
  const { error } = await _supabase
    .from(table)
    .delete()
    .eq('id', msgId);

  if (error) {
    Swal.fire({
      title: 'ERROR',
      text: error.message,
      icon: 'error',
      customClass: { popup: 'nfs-crt-modal' }
    });
    return;
  }

  const el = document.getElementById(`msg-${msgId}`);
  if (el) el.closest('.chat-msg-wrapper')?.remove() || el.remove();
};

/**
 * Инициализация Realtime подписок для публичного канала и ЛС
 */
function initRealtime() {
  if (messagesSubscription) _supabase.removeChannel(messagesSubscription);
  if (dmsSubscription) _supabase.removeChannel(dmsSubscription);

  // 1. Публичные сообщения (слушают все)
  messagesSubscription = _supabase
    .channel('public:messages')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, payload => {
      if (currentChat.type === 'public') {
        renderMessage(payload.new, true);
      }
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, payload => {
      if (currentChat.type === 'public') {
        const textEl = document.getElementById(`msg-text-${payload.new.id}`);
        if (textEl) textEl.textContent = payload.new.text;
      }
    })
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages' }, payload => {
      if (currentChat.type === 'public') {
        const el = document.getElementById(`msg-${payload.old.id}`);
        if (el) el.closest('.chat-msg-wrapper')?.remove() || el.remove();
      }
    })
    .subscribe();

  // 2. Личные сообщения (только для авторизованных)
  if (currentUserId && !myProfile?.isGuest) {
    dmsSubscription = _supabase
      .channel(`user:dms:${currentUserId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'direct_messages' }, async payload => {
        const isCurrentDialog = currentChat.type === 'private' &&
          (payload.new.sender_id === currentChat.id || payload.new.sender_id === currentUserId);

        if (isCurrentDialog) {
          renderMessage(payload.new, true);
          if (payload.new.sender_id === currentChat.id) {
            await _supabase.from('direct_messages').update({ is_read: true }).eq('id', payload.new.id);
          }
        }

        await loadRecentDMs();
        if (typeof updateGlobalMsgBadge === 'function') updateGlobalMsgBadge(_supabase, currentUserId);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'direct_messages' }, payload => {
        if (currentChat.type === 'private') {
          const textEl = document.getElementById(`msg-text-${payload.new.id}`);
          if (textEl) textEl.textContent = payload.new.text;
        }
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'direct_messages' }, payload => {
        if (currentChat.type === 'private') {
          const el = document.getElementById(`msg-${payload.old.id}`);
          if (el) el.closest('.chat-msg-wrapper')?.remove() || el.remove();
        }
        loadRecentDMs();
      })
      .subscribe();
  }
}

function scrollBottom() {
  const box = document.getElementById('msgBox');
  if (box) box.scrollTop = box.scrollHeight;
}
