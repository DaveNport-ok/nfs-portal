import { _supabase } from '../config.js';

let isLogin = true;

// Настройки ограничений пароля
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 12;

/**
 * Переключение между авторизацией и регистрацией
 */
window.toggleForm = function () {
  isLogin = !isLogin;
  const errorEl = document.getElementById('errorMsg');
  if (errorEl) errorEl.style.display = 'none';

  const formTitle = document.getElementById('formTitle');
  const usernameInput = document.getElementById('username');
  const mainBtn = document.getElementById('mainBtn');
  const toggleBtn = document.getElementById('toggleBtn');

  if (formTitle) formTitle.innerText = isLogin ? "Enter the game" : "Racer Registration";
  if (usernameInput) usernameInput.style.display = isLogin ? "none" : "block";
  if (mainBtn) mainBtn.innerText = isLogin ? "Log in" : "Create profile";
  if (toggleBtn) {
    toggleBtn.innerText = isLogin ?
      "No account? Sign up!" : "Already have a profile? Log in.";
  }
};

/**
 * Вход в режиме гостя без создания профиля
 */
window.continueAsGuest = function () {
  // Очищаем статус гонщика, чтобы не подтянулся статус предыдущего аккаунта
  localStorage.removeItem('driver_status');
  window.location.href = 'index.html';
};

/**
 * Обработка отправки формы входа / регистрации
 */
window.handleAuth = async function () {
  const emailInput = document.getElementById('email');
  const passwordInput = document.getElementById('password');
  const usernameInput = document.getElementById('username');
  const mainBtn = document.getElementById('mainBtn');

  const email = emailInput ? emailInput.value.trim() : '';
  const password = passwordInput ? passwordInput.value.trim() : '';
  const username = usernameInput ? usernameInput.value.trim() : '';

  // 1. Проверка заполненности всех обязательных полей
  if (!email || !password || (!isLogin && !username)) {
    showError("Fill in all the fields.");
    return;
  }

  // 2. Валидация длины пароля (мин. и макс.)
  if (password.length < MIN_PASSWORD_LENGTH) {
    showError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters long.`);
    return;
  }

  if (password.length > MAX_PASSWORD_LENGTH) {
    showError(`Password cannot exceed ${MAX_PASSWORD_LENGTH} characters.`);
    return;
  }

  // Блокируем кнопку на время запроса
  if (mainBtn) {
    mainBtn.disabled = true;
    mainBtn.style.opacity = '0.6';
  }

  try {
    if (isLogin) {
      // --- ВХОД ---
      const { data, error } = await _supabase.auth.signInWithPassword({ email, password });
      if (error) {
        showError(error.message);
      } else {
        window.location.href = 'index.html';
      }
    } else {
      // --- РЕГИСТРАЦИЯ ---
      const { data, error } = await _supabase.auth.signUp({
        email,
        password,
        options: {
          data: { username: username },
          emailRedirectTo: window.location.origin + '/index.html'
        }
      });

      // Перехват явной ошибки Supabase (если в настройках отключена защита перебора)
      if (error) {
        if (error.message.toLowerCase().includes('already registered') ||
          error.message.toLowerCase().includes('already exists')) {
          showError("This email is already registered. Please log in.");
        } else {
          showError(error.message);
        }
        return;
      }

      // Перехват тихого дубликата Supabase:
      // Если email уже существует, Supabase возвращает объект user с пустым массивом identities: []
      if (data?.user && (!data.user.identities || data.user.identities.length === 0)) {
        showError("This email is already registered. Please log in.");
        return;
      }

      if (data?.session) {
        // Если подтверждение почты в Supabase отключено — пускаем сразу
        window.location.href = 'index.html';
      } else {
        Swal.fire({
          title: "DONE!",
          text: "Check your email for confirmation, or try logging in.",
          icon: "success",
          background: "#111",
          color: "#fff",
          confirmButtonColor: "#f1c40f"
        });
        window.toggleForm();
      }
    }
  } catch (err) {
    showError("Network or server connection error.");
    console.error(err);
  } finally {
    if (mainBtn) {
      mainBtn.disabled = false;
      mainBtn.style.opacity = '1';
    }
  }
};

function showError(text) {
  const errorEl = document.getElementById('errorMsg');
  if (errorEl) {
    errorEl.innerText = ">> " + text;
    errorEl.style.display = 'block';
  }
}

/**
 * Проверка активной сессии и поддержка клавиши Enter
 */
document.addEventListener('DOMContentLoaded', async () => {
  // 1. Если пользователь уже авторизован — сразу отправляем на главную
  if (typeof _supabase !== 'undefined') {
    const { data: { session } } = await _supabase.auth.getSession();
    if (session?.user) {
      window.location.href = 'index.html';
      return;
    }
  }

  // 2. Отправка формы по нажатию Enter в полях ввода
  const inputs = document.querySelectorAll('#email, #password, #username');
  inputs.forEach(input => {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        window.handleAuth();
      }
    });
  });
});
