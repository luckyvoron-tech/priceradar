/* Точка входа. */
document.addEventListener("DOMContentLoaded", () => {
  try {
    UI.init();
  } catch (e) {
    const el = document.getElementById("status");
    if (el) el.textContent = "Ошибка запуска: " + (e.message || e);
  }
});
