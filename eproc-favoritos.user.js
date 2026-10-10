// ==UserScript==
// @name         EPROC - Processos Favoritos
// @namespace    eproc-favoritos
// @version      1.6
// @description  Central de acompanhamento de processos favoritos integrada ao EPROC
// @updateURL    https://raw.githubusercontent.com/rsalvessap/Eproc-Favoritos/main/eproc-favoritos.user.js
// @downloadURL  https://raw.githubusercontent.com/rsalvessap/Eproc-Favoritos/main/eproc-favoritos.user.js
// @include      *://eproc*.tjsp.jus.br/*
// @include      *://*-1g-*.tjsp.jus.br/*
// @include      *://*-2g-*.tjsp.jus.br/*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
    'use strict';

    // ==============================
    // CONSTANTES
    // ==============================
    const DB_NAME = 'EPROC_FAVORITOS';
    const DB_VERSION = 1;
    const CORES_ETIQUETAS = [
        '#1565c0', '#2e7d32', '#c62828', '#f57f17',
        '#6a1b9a', '#00838f', '#d84315', '#37474f',
        '#ad1457', '#283593', '#00695c', '#ef6c00',
        '#4527a0', '#0277bd', '#558b2f', '#8e24aa'
    ];

    // Estado do módulo
    let _db = null;
    let _dbPromise = null;
    let _ultimaConsulta = null;
    let _ultimosParametros = null;
    let _painelAberto = false;
    let _ordenacao = { campo: 'ultimaAtualizacao', direcao: 'desc' };
    let _filtroEtiqueta = null;
    let _termoBusca = '';

    // Preferências do painel. O eproc navega a cada ação, então sem persistir isso a
    // ordenação e o filtro voltavam ao padrão toda vez que a página recarregava.
    const PREFS_KEY = 'eproc-fav-prefs';

    function carregarPrefs() {
        try {
            const p = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
            if (p.campo) _ordenacao.campo = p.campo;
            if (p.direcao === 'asc' || p.direcao === 'desc') _ordenacao.direcao = p.direcao;
            if (typeof p.filtroEtiqueta === 'string') _filtroEtiqueta = p.filtroEtiqueta;
        } catch (_) {}
    }

    function salvarPrefs() {
        try {
            localStorage.setItem(PREFS_KEY, JSON.stringify({
                campo: _ordenacao.campo,
                direcao: _ordenacao.direcao,
                filtroEtiqueta: _filtroEtiqueta
            }));
        } catch (_) {}
    }
    let _urlApiInterceptada = null; // URL real capturada do XHR do eproc

    // ==============================
    // CSS GLOBAL
    // ==============================
    function injetarEstilos() {
        const id = 'eproc-fav-styles';
        if (document.getElementById(id)) return;
        const style = document.createElement('style');
        style.id = id;
        style.textContent = `
            /* === Botões base === */
            .eproc-fav-btn {
                display: inline-flex;
                align-items: center;
                gap: 6px;
                padding: 8px 16px;
                border-radius: 6px;
                font-family: Arial, sans-serif;
                font-size: 13px;
                font-weight: 600;
                cursor: pointer;
                border: none;
                transition: background 0.15s ease, box-shadow 0.15s ease, transform 0.1s ease;
                white-space: nowrap;
                text-decoration: none;
                line-height: 1.2;
            }
            .eproc-fav-btn:hover  { filter: brightness(1.08); transform: translateY(-1px); }
            .eproc-fav-btn:active { transform: translateY(0px); filter: brightness(0.96); }

            .eproc-fav-btn-primary {
                background: #1565c0;
                color: white;
                box-shadow: 0 2px 6px rgba(21,101,192,0.30);
            }
            .eproc-fav-btn-primary:hover {
                background: #1976d2;
                box-shadow: 0 4px 12px rgba(21,101,192,0.40);
            }
            .eproc-fav-btn-danger {
                background: #c62828;
                color: white;
                box-shadow: 0 2px 6px rgba(198,40,40,0.30);
            }
            .eproc-fav-btn-danger:hover {
                background: #d32f2f;
                box-shadow: 0 4px 12px rgba(198,40,40,0.40);
            }
            .eproc-fav-btn-success {
                background: #2e7d32;
                color: white;
                box-shadow: 0 2px 6px rgba(46,125,50,0.30);
            }
            .eproc-fav-btn-success:hover {
                background: #388e3c;
                box-shadow: 0 4px 12px rgba(46,125,50,0.40);
            }
            .eproc-fav-btn-secondary {
                background: white;
                color: #444;
                border: 1.5px solid #ccc;
                box-shadow: none;
            }
            .eproc-fav-btn-secondary:hover {
                background: #f5f5f5;
                border-color: #999;
                filter: none;
                transform: none;
            }
            .eproc-fav-btn-ghost {
                background: transparent;
                color: #1565c0;
                border: 1.5px solid #1565c0;
                padding: 5px 12px;
                font-size: 12px;
                border-radius: 5px;
                box-shadow: none;
                font-weight: 600;
            }
            .eproc-fav-btn-ghost:hover {
                background: #e3f2fd;
                filter: none;
                transform: none;
            }
            .eproc-fav-btn:disabled {
                opacity: 0.55;
                cursor: not-allowed;
                transform: none !important;
                filter: none !important;
            }
            .eproc-fav-btn-sm {
                padding: 4px 10px;
                font-size: 11px;
                gap: 4px;
            }
            .eproc-fav-btn-icon {
                padding: 5px 7px;
                font-size: 14px;
                border-radius: 5px;
                min-width: 28px;
                justify-content: center;
            }

            /* === Overlay === */
            .eproc-fav-overlay {
                position: fixed;
                inset: 0;
                background: rgba(0,0,0,0.52);
                backdrop-filter: blur(2px);
                -webkit-backdrop-filter: blur(2px);
                z-index: 9999999;
                display: flex;
                align-items: center;
                justify-content: center;
                animation: eproc-fav-fade 0.15s ease;
            }
            @keyframes eproc-fav-fade {
                from { opacity: 0; }
                to   { opacity: 1; }
            }

            /* === Modal === */
            .eproc-fav-modal {
                background: white;
                border-radius: 12px;
                box-shadow: 0 20px 60px rgba(0,0,0,0.28);
                display: flex;
                flex-direction: column;
                font-family: Arial, sans-serif;
                animation: eproc-fav-slide 0.2s ease;
                overflow: hidden;
            }
            @keyframes eproc-fav-slide {
                from { opacity: 0; transform: translateY(14px) scale(0.98); }
                to   { opacity: 1; transform: translateY(0)   scale(1);    }
            }
            .eproc-fav-modal-header {
                padding: 18px 20px 14px;
                font-size: 15px;
                font-weight: 700;
                color: #1a1a1a;
                border-bottom: 1px solid #ececec;
                display: flex;
                align-items: center;
                justify-content: space-between;
            }
            .eproc-fav-modal-body {
                padding: 14px 20px;
                flex: 1;
                overflow-y: auto;
                display: flex;
                flex-direction: column;
                min-height: 0;
                gap: 10px;
            }
            .eproc-fav-modal-footer {
                padding: 12px 20px;
                display: flex;
                gap: 8px;
                justify-content: flex-end;
                border-top: 1px solid #ececec;
                background: #fafafa;
            }

            /* === Inputs === */
            .eproc-fav-input {
                padding: 7px 10px;
                border: 1.5px solid #ddd;
                border-radius: 6px;
                font-size: 13px;
                font-family: Arial, sans-serif;
                transition: border-color 0.15s, box-shadow 0.15s;
                outline: none;
                box-sizing: border-box;
                width: 100%;
            }
            .eproc-fav-input:focus {
                border-color: #1565c0;
                box-shadow: 0 0 0 3px rgba(21,101,192,0.12);
            }
            .eproc-fav-select {
                padding: 7px 10px;
                border: 1.5px solid #ddd;
                border-radius: 6px;
                font-size: 13px;
                font-family: Arial, sans-serif;
                background: white;
                cursor: pointer;
                outline: none;
                transition: border-color 0.15s, box-shadow 0.15s;
                box-sizing: border-box;
            }
            .eproc-fav-select:focus {
                border-color: #1565c0;
                box-shadow: 0 0 0 3px rgba(21,101,192,0.12);
            }
            .eproc-fav-textarea {
                padding: 8px 10px;
                border: 1.5px solid #ddd;
                border-radius: 6px;
                font-size: 13px;
                font-family: Arial, sans-serif;
                transition: border-color 0.15s, box-shadow 0.15s;
                outline: none;
                box-sizing: border-box;
                width: 100%;
                resize: vertical;
                min-height: 80px;
            }
            .eproc-fav-textarea:focus {
                border-color: #1565c0;
                box-shadow: 0 0 0 3px rgba(21,101,192,0.12);
            }

            /* === Trigger (botão fixo lateral) === */
            .eproc-fav-trigger {
                position: fixed;
                right: 0;
                top: 50%;
                transform: translateY(-50%);
                writing-mode: vertical-rl;
                background: #1565c0;
                color: white;
                padding: 14px 9px;
                border-radius: 8px 0 0 8px;
                cursor: pointer;
                font-family: Arial, sans-serif;
                font-size: 13px;
                font-weight: 700;
                z-index: 999997;
                box-shadow: -2px 2px 10px rgba(21,101,192,0.35);
                transition: background 0.15s, box-shadow 0.15s, padding 0.15s;
                display: flex;
                align-items: center;
                gap: 8px;
                user-select: none;
                letter-spacing: 0.5px;
            }
            .eproc-fav-trigger:hover {
                background: #1976d2;
                padding-right: 14px;
                box-shadow: -4px 2px 16px rgba(21,101,192,0.45);
            }
            .eproc-fav-trigger-badge {
                background: #c62828;
                color: white;
                font-size: 10px;
                font-weight: 700;
                padding: 2px 5px;
                border-radius: 8px;
                writing-mode: horizontal-tb;
                min-width: 16px;
                text-align: center;
                line-height: 1.3;
            }

            /* === Sidebar (painel lateral) === */
            .eproc-fav-sidebar {
                position: fixed;
                top: 0;
                right: 0;
                width: 440px;
                height: 100vh;
                background: #f8f9fa;
                box-shadow: -4px 0 24px rgba(0,0,0,0.18);
                z-index: 999998;
                transform: translateX(100%);
                transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                display: flex;
                flex-direction: column;
                font-family: Arial, sans-serif;
            }
            .eproc-fav-sidebar.eproc-fav-aberto {
                transform: translateX(0);
            }
            .eproc-fav-sidebar-header {
                padding: 16px 20px 12px;
                background: #1565c0;
                color: white;
                display: flex;
                align-items: center;
                justify-content: space-between;
                flex-shrink: 0;
            }
            .eproc-fav-sidebar-header h2 {
                margin: 0;
                font-size: 16px;
                font-weight: 700;
                letter-spacing: 0.3px;
            }
            .eproc-fav-sidebar-close {
                background: none;
                border: none;
                color: white;
                font-size: 22px;
                cursor: pointer;
                padding: 2px 6px;
                border-radius: 4px;
                opacity: 0.8;
                transition: opacity 0.15s, background 0.15s;
                line-height: 1;
            }
            .eproc-fav-sidebar-close:hover {
                opacity: 1;
                background: rgba(255,255,255,0.15);
            }
            .eproc-fav-sidebar-toolbar {
                padding: 12px 16px;
                background: white;
                border-bottom: 1px solid #e8e8e8;
                display: flex;
                flex-direction: column;
                gap: 8px;
                flex-shrink: 0;
            }
            .eproc-fav-sidebar-acoes {
                display: flex;
                gap: 6px;
                align-items: center;
                flex-wrap: wrap;
            }
            .eproc-fav-sidebar-filtros {
                display: flex;
                gap: 6px;
                align-items: center;
                flex-wrap: wrap;
            }
            .eproc-fav-sidebar-lista {
                flex: 1;
                overflow-y: auto;
                padding: 12px 16px;
                min-height: 0;
            }
            .eproc-fav-sidebar-vazio {
                text-align: center;
                color: #999;
                font-size: 13px;
                padding: 40px 20px;
            }
            .eproc-fav-sidebar-footer {
                padding: 10px 16px;
                background: white;
                border-top: 1px solid #e8e8e8;
                display: flex;
                gap: 6px;
                justify-content: center;
                flex-shrink: 0;
                flex-wrap: wrap;
            }

            /* === Card de processo === */
            .eproc-fav-card {
                background: white;
                border: 1.5px solid #e0e0e0;
                border-radius: 8px;
                padding: 12px 14px;
                margin-bottom: 10px;
                transition: border-color 0.15s, box-shadow 0.15s;
                position: relative;
            }
            .eproc-fav-card:hover {
                border-color: #90caf9;
                box-shadow: 0 2px 10px rgba(21,101,192,0.12);
            }
            .eproc-fav-card-top {
                display: flex;
                align-items: flex-start;
                gap: 8px;
            }
            .eproc-fav-card-star {
                color: #f9a825;
                font-size: 18px;
                flex-shrink: 0;
                cursor: pointer;
                line-height: 1;
            }
            .eproc-fav-card-numero {
                font-size: 13px;
                font-weight: 700;
                color: #1565c0;
                cursor: pointer;
                text-decoration: none;
                word-break: break-all;
            }
            .eproc-fav-card-numero:hover { text-decoration: underline; }
            .eproc-fav-card-badge-novo {
                display: inline-flex;
                align-items: center;
                padding: 1px 6px;
                border-radius: 4px;
                font-size: 9px;
                font-weight: 700;
                background: #e3f2fd;
                color: #1565c0;
                border: 1px solid #90caf9;
                margin-left: 6px;
                white-space: nowrap;
            }
            .eproc-fav-card-incompleto {
                font-size: 10px;
                color: #e65100;
                background: #fff3e0;
                border: 1px solid #ffb74d;
                border-radius: 4px;
                padding: 3px 8px;
                margin-top: 6px;
                text-align: center;
            }
            .eproc-fav-card-partes {
                font-size: 11.5px;
                color: #333;
                margin-top: 6px;
                line-height: 1.5;
            }
            .eproc-fav-card-partes strong { color: #666; font-weight: 600; font-size: 10px; text-transform: uppercase; }
            .eproc-fav-card-info {
                font-size: 11px;
                color: #555;
                margin-top: 6px;
                display: flex;
                flex-wrap: wrap;
                gap: 3px 14px;
                line-height: 1.5;
            }
            .eproc-fav-card-info span strong { font-weight: 600; color: #777; }
            .eproc-fav-card-evento {
                font-size: 11px;
                color: #777;
                margin-top: 5px;
                font-style: italic;
                line-height: 1.4;
            }
            .eproc-fav-card-obs {
                font-size: 11px;
                color: #555;
                margin-top: 6px;
                padding: 5px 8px;
                background: #fff8e1;
                border-radius: 4px;
                border-left: 3px solid #ffb300;
                line-height: 1.4;
                white-space: pre-wrap;
                max-height: 60px;
                overflow: hidden;
            }
            .eproc-fav-card-tags {
                display: flex;
                flex-wrap: wrap;
                gap: 4px;
                margin-top: 6px;
            }
            .eproc-fav-card-acoes {
                display: flex;
                gap: 5px;
                margin-top: 8px;
                padding-top: 8px;
                border-top: 1px solid #f0f0f0;
            }

            /* === Estrela na tabela === */
            /* Injetada dentro da célula do número do processo, não em coluna própria.
               inline-block + largura fixa mantém os números alinhados entre as linhas. */
            .eproc-fav-star {
                cursor: pointer;
                font-size: 16px;
                transition: transform 0.15s;
                user-select: none;
                line-height: 1;
                display: inline-block;
                width: 16px;
                margin-right: 5px;
                text-align: center;
                vertical-align: baseline;
            }
            .eproc-fav-star:hover { transform: scale(1.25); }
            .eproc-fav-star-ativo { color: #f9a825; }
            .eproc-fav-star-inativo { color: #ccc; }

            /* === Etiquetas (tags) === */
            .eproc-fav-tag {
                display: inline-flex;
                align-items: center;
                padding: 2px 8px;
                border-radius: 12px;
                font-size: 10px;
                font-weight: 600;
                color: white;
                gap: 4px;
                cursor: default;
                line-height: 1.4;
            }
            .eproc-fav-tag-filter {
                cursor: pointer;
                opacity: 0.85;
                transition: opacity 0.1s, transform 0.1s;
            }
            .eproc-fav-tag-filter:hover { opacity: 1; transform: scale(1.05); }
            .eproc-fav-tag-filter.eproc-fav-tag-active {
                opacity: 1;
                box-shadow: 0 0 0 2px white, 0 0 0 3.5px currentColor;
            }

            /* === Toast === */
            .eproc-fav-toast {
                position: fixed;
                bottom: 24px;
                right: 24px;
                padding: 12px 20px;
                border-radius: 8px;
                font-family: Arial, sans-serif;
                font-size: 13px;
                font-weight: 500;
                color: white;
                z-index: 99999999;
                box-shadow: 0 4px 16px rgba(0,0,0,0.22);
                animation: eproc-fav-toast-in 0.3s ease;
                max-width: 400px;
                line-height: 1.4;
                display: flex;
                align-items: center;
                gap: 10px;
            }
            .eproc-fav-toast-sucesso { background: #2e7d32; }
            .eproc-fav-toast-erro    { background: #c62828; }
            .eproc-fav-toast-info    { background: #1565c0; }
            .eproc-fav-toast button {
                background: rgba(255,255,255,0.25);
                border: 1px solid rgba(255,255,255,0.4);
                color: white;
                padding: 3px 10px;
                border-radius: 4px;
                font-size: 11px;
                font-weight: 600;
                cursor: pointer;
                white-space: nowrap;
            }
            .eproc-fav-toast button:hover { background: rgba(255,255,255,0.4); }
            @keyframes eproc-fav-toast-in {
                from { opacity: 0; transform: translateY(20px); }
                to   { opacity: 1; transform: translateY(0); }
            }

            /* === Barra de progresso === */
            .eproc-fav-progress-track {
                background: #eee;
                border-radius: 8px;
                height: 10px;
                overflow: hidden;
            }
            .eproc-fav-progress-bar {
                height: 100%;
                border-radius: 8px;
                transition: width 0.3s ease;
                background: linear-gradient(90deg, #1565c0, #42a5f5);
            }

            /* === Spinner === */
            .eproc-fav-spinner {
                width: 22px;
                height: 22px;
                border: 3px solid rgba(21,101,192,0.20);
                border-top-color: #1565c0;
                border-radius: 50%;
                animation: eproc-fav-spin 0.8s linear infinite;
                display: inline-block;
            }
            .eproc-fav-spinner-sm {
                width: 14px;
                height: 14px;
                border-width: 2px;
            }
            @keyframes eproc-fav-spin {
                to { transform: rotate(360deg); }
            }

            /* === Botões na capa do processo === */
            .eproc-fav-capa-acoes {
                display: inline-flex;
                gap: 6px;
                margin-left: 10px;
                vertical-align: middle;
            }
            .eproc-fav-capa-btn {
                display: inline-flex;
                align-items: center;
                gap: 4px;
                padding: 3px 10px;
                border-radius: 5px;
                font-family: Arial, sans-serif;
                font-size: 12px;
                font-weight: 600;
                cursor: pointer;
                border: 1.5px solid #90caf9;
                background: #e3f2fd;
                color: #0d47a1;
                transition: background 0.15s, border-color 0.15s;
                white-space: nowrap;
            }
            .eproc-fav-capa-btn:hover {
                background: #bbdefb;
                border-color: #42a5f5;
            }
            .eproc-fav-capa-btn-ativo {
                background: #fff8e1;
                border-color: #f9a825;
                color: #f57f17;
            }
            .eproc-fav-capa-btn-ativo:hover {
                background: #fff3c4;
                border-color: #f9a825;
            }

            /* === Lista de consultas/etiquetas === */
            .eproc-fav-list {
                overflow-y: auto;
                flex: 1;
                border: 1.5px solid #e8e8e8;
                border-radius: 6px;
                padding: 4px 6px;
                min-height: 0;
            }
            .eproc-fav-list-item {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 7px 8px;
                border-radius: 5px;
                cursor: pointer;
                transition: background 0.1s;
                font-size: 13px;
                color: #222;
                border-bottom: 1px solid #f5f5f5;
            }
            .eproc-fav-list-item:last-child { border-bottom: none; }
            .eproc-fav-list-item:hover { background: #f0f6ff; }
            .eproc-fav-list-item-acoes {
                margin-left: auto;
                display: flex;
                gap: 4px;
                opacity: 0;
                transition: opacity 0.15s;
            }
            .eproc-fav-list-item:hover .eproc-fav-list-item-acoes { opacity: 1; }

            /* === Resultado de busca === */
            .eproc-fav-resultado {
                display: flex;
                align-items: flex-start;
                gap: 8px;
                padding: 8px;
                border-radius: 6px;
                border: 1px solid #e8e8e8;
                margin-bottom: 6px;
                font-size: 12px;
                transition: background 0.1s;
            }
            .eproc-fav-resultado:hover { background: #f5f9ff; }
            .eproc-fav-resultado-info { flex: 1; line-height: 1.5; color: #333; }
            .eproc-fav-resultado-num { font-weight: 700; color: #1565c0; }

            /* === Misc === */
            .eproc-fav-label {
                font-size: 12px;
                font-weight: 600;
                color: #555;
                margin-bottom: 2px;
            }
            .eproc-fav-empty {
                text-align: center;
                color: #999;
                font-size: 12px;
                padding: 16px;
            }
            .eproc-fav-divider {
                border: none;
                border-top: 1px solid #ececec;
                margin: 4px 0;
            }
            .eproc-fav-counter {
                margin-left: auto;
                font-size: 12px;
                color: #666;
                font-weight: 500;
                background: #f0f4f8;
                padding: 3px 8px;
                border-radius: 12px;
            }
        `;
        (document.head || document.documentElement).appendChild(style);
    }

    // ==============================
    // SVGs
    // ==============================
    const SVG_SEARCH = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
    const SVG_REFRESH = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>';
    const SVG_TRASH = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>';
    const SVG_OPEN = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>';
    const SVG_DOWNLOAD = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
    const SVG_UPLOAD = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>';
    const SVG_PLUS = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
    const SVG_TAG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>';
    const SVG_NOTE = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>';
    const SVG_FOLDER = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>';
    const SVG_SETTINGS = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>';
    const SVG_SORT = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 3 18 9"/><polyline points="6 15 12 21 18 15"/></svg>';
    const SVG_SAVE = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>';

    // ==============================
    // UTILITÁRIOS
    // ==============================
    const sleep = ms => new Promise(r => setTimeout(r, ms));

    function normalizarBusca(txt) {
        if (!txt) return '';
        return txt.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    }

    function hashString(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) - hash) + str.charCodeAt(i);
            hash = hash & hash;
        }
        return hash.toString(36);
    }

    // Hash usado para detectar que um processo mudou desde a última consulta.
    //
    // A API processos_consulta_por_nome_parte devolve APENAS: nr_processo, autor, reu,
    // classe, str_sig_orgao_juizo, des_situacao. `ultimo_evento` e `des_assuntos` NÃO
    // vêm nela — incluí-los aqui (como na v1.4) deixava o hash preso em '' para os dois
    // campos que de fato mudam quando o processo anda, e por isso o badge "ATUALIZADO"
    // praticamente nunca acendia.
    //
    // O último evento só existe na capa do processo, então ele entra no hash apenas
    // quando já foi capturado (ver extrairDadosDaCapa) — nunca zerando um valor
    // previamente conhecido.
    function gerarHash(obj) {
        return hashString(JSON.stringify({
            s: obj.des_situacao || '',
            c: obj.classe || '',
            j: obj.str_sig_orgao_juizo || '',
            e: obj.ultimo_evento || ''
        }));
    }

    function parsePostParams(body) {
        if (!body) return {};
        const params = {};
        if (typeof body === 'string') {
            try {
                new URLSearchParams(body).forEach((v, k) => { params[k] = v; });
            } catch (_) {
                body.split('&').forEach(pair => {
                    const idx = pair.indexOf('=');
                    if (idx > -1) params[decodeURIComponent(pair.slice(0, idx))] = decodeURIComponent(pair.slice(idx + 1));
                });
            }
        }
        return params;
    }

    // Abre um processo usando o form de pesquisa rápida do eproc (#formPesquisaRapida,
    // presente em todas as páginas). NUNCA montar uma URL de capa manualmente: o eproc
    // exige um `hash` assinado e, se ele estiver ausente/inválido, o servidor não apenas
    // recusa a requisição — ele ENCERRA A SESSÃO do usuário (verificado em 2026-09-29).
    //
    // O form é method=POST, sem onsubmit, e tem dois submits que se diferenciam só pelo
    // `name` enviado no corpo:
    //   btnPesquisaRapidaSubmit        -> abre na mesma janela
    //   btnPesquisaRapidaSubmitNovaAba -> abre em nova janela (o eproc cuida disso)
    // Por isso usamos .click() no botão: um clique real em <button type="submit"> inclui
    // o name dele no POST. form.submit() NÃO inclui, e eventos de teclado sintéticos não
    // disparam submissão implícita de form — só o Enter real do usuário.
    function preencherPesquisaRapida(numero, novaAba) {
        const campo = document.querySelector('#txtNumProcessoPesquisaRapida');
        if (!campo) return false;
        const form = campo.closest('form');
        if (!form) return false;

        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
        if (nativeSetter) nativeSetter.call(campo, numero);
        else campo.value = numero;
        campo.dispatchEvent(new Event('input', { bubbles: true }));
        campo.dispatchEvent(new Event('change', { bubbles: true }));

        const nome = novaAba ? 'btnPesquisaRapidaSubmitNovaAba' : 'btnPesquisaRapidaSubmit';
        const btn = form.querySelector(`[name="${nome}"]`)
                 || form.querySelector('[name="btnPesquisaRapidaSubmit"]');
        if (!btn) return false;
        btn.click();
        return true;
    }

    // Abre um processo em nova aba, delegando a abertura ao próprio eproc.
    async function abrirProcesso(proc) {
        const num = proc.numero || proc.nr_processo;
        if (!num) {
            mostrarToast('Número do processo não disponível', 'erro');
            return;
        }

        if (proc.novo) {
            proc.novo = false;
            await salvarProcesso(proc);
            atualizarBadgeTrigger().catch(e => console.warn('[EPROC-FAV]', e));
        }

        if (!preencherPesquisaRapida(num, true)) {
            mostrarToast('Campo de pesquisa rápida do eproc não encontrado nesta página', 'erro');
        }
    }

    function prepararProcesso(apiObj, parametros) {
        return {
            ...apiObj,
            numero: apiObj.nr_processo,
            observacoes: '',
            tags: [],
            favorito: true,
            ultimaAtualizacao: Date.now(),
            hashConsulta: gerarHash(apiObj),
            novo: false,
            _consulta: parametros || null
        };
    }

    function mesclarProcesso(existente, apiObj) {
        // A consulta por nome não devolve ultimo_evento nem des_assuntos. Espalhar
        // ...apiObj cru apagaria o que já tínhamos capturado da capa e faria o hash
        // mudar sozinho (marcando o processo como "novo" sem nada ter acontecido).
        // Só sobrescrevemos um campo quando a API realmente trouxe valor para ele.
        const mesclado = { ...existente };
        for (const [chave, valor] of Object.entries(apiObj)) {
            if (valor !== undefined && valor !== null && valor !== '') mesclado[chave] = valor;
        }

        const novoHash = gerarHash(mesclado);
        return {
            ...mesclado,
            numero: apiObj.nr_processo || existente.numero,
            observacoes: existente.observacoes || '',
            tags: existente.tags || [],
            favorito: true,
            ultimaAtualizacao: Date.now(),
            hashConsulta: novoHash,
            novo: existente.novo || novoHash !== existente.hashConsulta,
            _consulta: existente._consulta
        };
    }

    // Verifica se um processo tem dados completos ou só o número
    function processoIncompleto(proc) {
        return !proc.autor && !proc.reu && !proc.classe;
    }

    function debounce(fn, ms) {
        let timer;
        return function (...args) {
            clearTimeout(timer);
            timer = setTimeout(() => fn.apply(this, args), ms);
        };
    }

    function extrairNumeroProcesso(texto) {
        if (!texto) return null;
        const match = texto.match(/\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/);
        return match ? match[0] : null;
    }

    function corEtiqueta(nome) {
        let hash = 0;
        for (let i = 0; i < nome.length; i++) {
            hash = ((hash << 5) - hash) + nome.charCodeAt(i);
            hash = hash & hash;
        }
        return CORES_ETIQUETAS[Math.abs(hash) % CORES_ETIQUETAS.length];
    }

    // Extrai dados de uma linha da tabela de processos do eproc
    function extrairDadosDaLinha(row) {
        const cells = Array.from(row.cells || []);
        const dados = { nr_processo: null, linkProcessoAssinado: '' };

        // Procurar link com número do processo
        for (const a of row.querySelectorAll('a')) {
            const num = extrairNumeroProcesso(a.textContent);
            if (num) {
                dados.nr_processo = num;
                dados.linkProcessoAssinado = a.href || '';
                break;
            }
        }

        const textos = cells.map(c => c.textContent.trim());

        // O número nem sempre vem dentro de um <a> (algumas telas mostram texto puro),
        // e sem esse fallback a linha inteira seria ignorada.
        if (!dados.nr_processo) {
            for (const t of textos) {
                const num = extrairNumeroProcesso(t);
                if (num) { dados.nr_processo = num; break; }
            }
        }

        // Tabela típica: Processo, Autor, Réu, Classe, Último Evento, Assuntos, Situação.
        // A ordem varia entre telas, então mapeamos por posição relativa ao número.
        if (textos.length >= 5) {
            let startIdx = 0;
            for (let i = 0; i < textos.length; i++) {
                if (extrairNumeroProcesso(textos[i])) { startIdx = i + 1; break; }
            }
            if (textos[startIdx]) dados.autor = textos[startIdx];
            if (textos[startIdx + 1]) dados.reu = textos[startIdx + 1];
            if (textos[startIdx + 2]) dados.classe = textos[startIdx + 2];
            if (textos[startIdx + 3]) dados.ultimo_evento = textos[startIdx + 3];
            if (textos[startIdx + 4]) dados.des_assuntos = textos[startIdx + 4];
            if (textos[startIdx + 5]) dados.des_situacao = textos[startIdx + 5];
        }

        return dados;
    }

    // ==============================
    // INDEXEDDB
    // ==============================
    function abrirBanco() {
        if (_db) return Promise.resolve(_db);
        // Deduplica aberturas concorrentes: sem isso, várias chamadas simultâneas
        // a dbTransaction() disparariam vários indexedDB.open() em paralelo.
        if (_dbPromise) return _dbPromise;
        _dbPromise = new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('processos')) {
                    const store = db.createObjectStore('processos', { keyPath: 'numero' });
                    store.createIndex('autor', 'autor', { unique: false });
                    store.createIndex('reu', 'reu', { unique: false });
                    store.createIndex('classe', 'classe', { unique: false });
                    store.createIndex('situacao', 'des_situacao', { unique: false });
                    store.createIndex('favorito', 'favorito', { unique: false });
                    store.createIndex('tags', 'tags', { unique: false, multiEntry: true });
                }
                if (!db.objectStoreNames.contains('consultas')) {
                    db.createObjectStore('consultas', { keyPath: 'id', autoIncrement: true });
                }
                if (!db.objectStoreNames.contains('etiquetas')) {
                    db.createObjectStore('etiquetas', { keyPath: 'nome' });
                }
            };
            req.onblocked = () => {
                _dbPromise = null;
                reject(new Error('Banco bloqueado por outra aba do eproc. Feche as outras abas e recarregue.'));
            };
            req.onsuccess = (e) => {
                _db = e.target.result;
                // Se o navegador fechar a conexão (upgrade em outra aba, descarte por
                // inatividade), limpar o cache para que a próxima operação reabra.
                _db.onclose = () => { _db = null; _dbPromise = null; };
                _db.onversionchange = () => {
                    if (_db) { _db.close(); _db = null; _dbPromise = null; }
                };
                resolve(_db);
            };
            req.onerror = (e) => { _dbPromise = null; reject(e.target.error); };
        });
        return _dbPromise;
    }

    async function dbTransaction(storeName, mode) {
        const db = await abrirBanco();
        return db.transaction(storeName, mode).objectStore(storeName);
    }

    function dbRequest(store, method, ...args) {
        return new Promise((resolve, reject) => {
            const req = store[method](...args);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    async function salvarProcesso(processo) {
        return dbRequest(await dbTransaction('processos', 'readwrite'), 'put', processo);
    }

    async function obterProcesso(numero) {
        // store.get(undefined) lança DataError em vez de devolver "não encontrado".
        if (!numero) return undefined;
        return dbRequest(await dbTransaction('processos', 'readonly'), 'get', numero);
    }

    async function listarFavoritos() {
        return dbRequest(await dbTransaction('processos', 'readonly'), 'getAll');
    }

    async function removerProcesso(numero) {
        return dbRequest(await dbTransaction('processos', 'readwrite'), 'delete', numero);
    }

    async function salvarConsulta(consulta) {
        return dbRequest(await dbTransaction('consultas', 'readwrite'), 'put', consulta);
    }

    async function listarConsultas() {
        return dbRequest(await dbTransaction('consultas', 'readonly'), 'getAll');
    }

    async function removerConsulta(id) {
        return dbRequest(await dbTransaction('consultas', 'readwrite'), 'delete', id);
    }

    async function salvarEtiqueta(etiqueta) {
        return dbRequest(await dbTransaction('etiquetas', 'readwrite'), 'put', etiqueta);
    }

    async function listarEtiquetas() {
        return dbRequest(await dbTransaction('etiquetas', 'readonly'), 'getAll');
    }

    async function removerEtiqueta(nome) {
        return dbRequest(await dbTransaction('etiquetas', 'readwrite'), 'delete', nome);
    }

    // ==============================
    // COMPONENTES UI
    // ==============================
    function criarOverlay(onClick) {
        const overlay = document.createElement('div');
        overlay.className = 'eproc-fav-overlay';
        if (onClick) overlay.addEventListener('click', (e) => { if (e.target === overlay) onClick(); });
        return overlay;
    }

    function criarModal(titulo, largura) {
        const overlay = criarOverlay(() => overlay.remove());
        const modal = document.createElement('div');
        modal.className = 'eproc-fav-modal';
        modal.style.cssText = `width:${largura || 500}px;max-height:85vh`;
        modal.addEventListener('click', e => e.stopPropagation());

        const header = document.createElement('div');
        header.className = 'eproc-fav-modal-header';
        const tituloSpan = document.createElement('span');
        tituloSpan.textContent = titulo;
        header.appendChild(tituloSpan);
        const closeBtn = document.createElement('button');
        closeBtn.className = 'eproc-fav-sidebar-close';
        closeBtn.style.cssText = 'color:#666;font-size:18px';
        closeBtn.innerHTML = '&times;';
        closeBtn.onclick = () => overlay.remove();
        header.appendChild(closeBtn);

        const body = document.createElement('div');
        body.className = 'eproc-fav-modal-body';

        const footer = document.createElement('div');
        footer.className = 'eproc-fav-modal-footer';

        modal.append(header, body, footer);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        return { overlay, modal, header, body, footer, fechar: () => overlay.remove() };
    }

    function mostrarToast(msg, tipo, botoes) {
        document.querySelectorAll('.eproc-fav-toast').forEach(t => t.remove());
        const toast = document.createElement('div');
        toast.className = `eproc-fav-toast eproc-fav-toast-${tipo || 'info'}`;

        const span = document.createElement('span');
        span.textContent = msg;
        toast.appendChild(span);

        // Botões opcionais no toast (ex: "Salvar consulta")
        if (botoes && botoes.length) {
            botoes.forEach(b => {
                const btn = document.createElement('button');
                btn.textContent = b.texto;
                btn.addEventListener('click', () => {
                    toast.remove();
                    b.acao();
                });
                toast.appendChild(btn);
            });
        }

        document.body.appendChild(toast);
        const duração = botoes && botoes.length ? 8000 : 3000;
        setTimeout(() => {
            toast.style.transition = 'opacity 0.3s';
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        }, duração);
    }

    async function confirmar(msg) {
        return new Promise(resolve => {
            const { body, footer, fechar } = criarModal('Confirmação', 400);
            const p = document.createElement('p');
            p.style.cssText = 'font-size:13px;color:#333;line-height:1.5;margin:0';
            p.textContent = msg;
            body.appendChild(p);
            footer.innerHTML = `
                <button class="eproc-fav-btn eproc-fav-btn-secondary" data-acao="nao">Cancelar</button>
                <button class="eproc-fav-btn eproc-fav-btn-danger" data-acao="sim">Confirmar</button>
            `;
            footer.querySelector('[data-acao="nao"]').onclick = () => { fechar(); resolve(false); };
            footer.querySelector('[data-acao="sim"]').onclick = () => { fechar(); resolve(true); };
        });
    }

    // ==============================
    // INTERCEPTOR XMLHttpRequest
    // ==============================
    function instalarInterceptor() {
        const _open = XMLHttpRequest.prototype.open;
        const _send = XMLHttpRequest.prototype.send;

        XMLHttpRequest.prototype.open = function (method, url, ...args) {
            this._eprocFavUrl = url || '';
            return _open.call(this, method, url, ...args);
        };

        XMLHttpRequest.prototype.send = function (body) {
            if (this._eprocFavUrl && this._eprocFavUrl.includes('processos_consulta_por_nome_parte')) {
                // Capturar URL real usada pelo eproc para reuso em chamadas diretas
                try {
                    const fullUrl = new URL(this._eprocFavUrl, location.href);
                    // Salvar URL completa (inclui hash se o eproc usar)
                    _urlApiInterceptada = fullUrl.href;
                    // Salvar URL completa para a sessão atual
                    sessionStorage.setItem('eproc-fav-api-full-url', fullUrl.href);
                    console.log('[EPROC-FAV] URL API capturada:', fullUrl.href);
                } catch (_) {}

                const params = parsePostParams(body);
                this.addEventListener('load', function () {
                    try {
                        const json = JSON.parse(this.responseText);
                        if (json && json.resultados) {
                            _ultimaConsulta = json;
                            _ultimosParametros = params;
                            document.dispatchEvent(new CustomEvent('eproc-fav:consulta', {
                                detail: { resultados: json.resultados, parametros: params }
                            }));

                            const nome = params.strNomeParte || '';
                            if (nome) ofertarSalvarConsulta(nome, params, json.resultados.length);
                        }
                    } catch (_) {}
                });
            }
            return _send.call(this, body);
        };
    }

    // Nomes de parte para os quais já oferecemos salvar nesta sessão. O eproc refaz o
    // mesmo XHR ao repaginar ou reordenar a tabela, então sem isso o toast reaparecia a
    // cada interação — e, como mostrarToast() remove os toasts existentes, ele engolia
    // as mensagens de "adicionado aos favoritos".
    const _consultasJaOfertadas = new Set();

    async function ofertarSalvarConsulta(nome, params, qtd) {
        if (_consultasJaOfertadas.has(nome)) return;
        _consultasJaOfertadas.add(nome);

        // Não oferecer o que já está salvo.
        try {
            const salvas = await listarConsultas();
            if (salvas.some(c => c.nome === nome)) return;
        } catch (_) {}

        mostrarToast(
            `Consulta: "${nome}" (${qtd} resultado${qtd !== 1 ? 's' : ''})`,
            'info',
            [{
                texto: '💾 Salvar consulta',
                acao: async () => {
                    try {
                        await salvarConsulta({ nome, parametros: params, dataCriacao: Date.now() });
                        mostrarToast(`Consulta "${nome}" salva!`, 'sucesso');
                    } catch (e) {
                        console.warn('[EPROC-FAV] Erro ao salvar consulta:', e);
                        mostrarToast('Erro ao salvar consulta', 'erro');
                    }
                }
            }]
        );
    }

    // ==============================
    // URL DA API (com hash assinado)
    // ==============================
    // A URL da consulta por nome só funciona com o `hash` assinado da sessão atual.
    // NUNCA montar essa URL à mão: sem hash o eproc devolve a tela de login (o antigo
    // erro "Sessão expirada ou URL incorreta") e ainda encerra a sessão do usuário.
    const RE_URL_API = /controlador_ajax\.php\?acao_ajax=processos_consulta_por_nome_parte[^"'\s<>\\]*/;

    function extrairUrlApi(html, baseHref) {
        const m = (html || '').match(RE_URL_API);
        if (!m || !m[0].includes('hash=')) return null;
        try {
            return new URL(m[0].replace(/&amp;/g, '&'), baseHref).href;
        } catch (_) {
            return null;
        }
    }

    // Busca a tela de consulta por nome através do link do próprio menu do eproc (que
    // já vem com hash válido) e extrai dela a URL da API.
    async function descobrirUrlApiPeloMenu() {
        const link = [...document.querySelectorAll('a[href*="hash="]')]
            .find(a => /acao=[^&]*nome[^&]*parte/i.test(a.getAttribute('href') || ''));
        if (!link) return null;
        try {
            const resp = await fetch(link.href, { credentials: 'same-origin' });
            if (!resp.ok) return null;
            return extrairUrlApi(await resp.text(), link.href);
        } catch (e) {
            console.warn('[EPROC-FAV] Falha ao buscar a tela de consulta por nome:', e);
            return null;
        }
    }

    async function obterUrlApi() {
        // 1. Capturada do XHR do eproc nesta página
        if (_urlApiInterceptada) return _urlApiInterceptada;

        // 2. Presente no HTML da página atual (tela de consulta por nome)
        // 3. Presente na tela de consulta por nome, alcançada pelo link do menu
        const url = extrairUrlApi(document.documentElement.innerHTML, location.href)
                 || await descobrirUrlApiPeloMenu();
        if (url) {
            _urlApiInterceptada = url;
            sessionStorage.setItem('eproc-fav-api-full-url', url);
            return url;
        }

        // 4. Capturada em outra página desta mesma aba
        return sessionStorage.getItem('eproc-fav-api-full-url');
    }

    function esquecerUrlApi() {
        _urlApiInterceptada = null;
        sessionStorage.removeItem('eproc-fav-api-full-url');
    }

    // Garante que todo resultado tenha `nr_processo`. A API pode devolver itens sem o
    // número, e um único deles derrubava a lista inteira com "Failed to execute 'get'
    // on 'IDBObjectStore': No key or key range specified".
    function normalizarResultados(resultados) {
        const lista = Array.isArray(resultados)
            ? resultados
            : (resultados && typeof resultados === 'object' ? Object.values(resultados) : []);
        const validos = [];
        let ignorados = 0;

        for (const item of lista) {
            let numero = null;
            if (item && typeof item === 'object') {
                numero = item.nr_processo;
                if (!numero) {
                    for (const valor of Object.values(item)) {
                        numero = typeof valor === 'string' ? extrairNumeroProcesso(valor) : null;
                        if (numero) break;
                    }
                }
            }
            if (!numero) {
                if (!ignorados) {
                    console.warn('[EPROC-FAV] Resultado sem número de processo. Campos recebidos:',
                        item && typeof item === 'object' ? Object.keys(item) : typeof item);
                }
                ignorados++;
                continue;
            }
            validos.push(Array.isArray(item) ? { nr_processo: numero } : { ...item, nr_processo: numero });
        }

        return { resultados: validos, ignorados };
    }

    // Chamada direta à API do eproc
    async function executarConsultaAPI(parametros) {
        const url = await obterUrlApi();
        if (!url) {
            throw new Error('Não foi possível obter o endereço da consulta nesta sessão. Abra a tela de consulta por nome da parte no eproc, faça uma pesquisa qualquer e tente novamente.');
        }

        return new Promise((resolve, reject) => {
            console.log('[EPROC-FAV] Consultando API:', url, parametros);

            const xhr = new XMLHttpRequest();
            xhr.open('POST', url, true);
            xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
            // Header que o jQuery do eproc envia — sem ele o servidor pode rejeitar
            xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
            xhr.timeout = 30000;

            xhr.onload = function () {
                // Se o eproc redirecionou para login, o status será 200 mas o corpo será HTML
                if (this.status === 401 || this.status === 403) {
                    reject(new Error('Sessão expirada. Faça login no eproc e tente novamente.'));
                    return;
                }
                const resposta = this.responseText || '';
                // Detectar redirect para login (resposta é HTML em vez de JSON)
                if (resposta.trimStart().startsWith('<') || resposta.includes('login') && resposta.includes('<form')) {
                    console.warn('[EPROC-FAV] Resposta é HTML (possível redirect para login):', resposta.substring(0, 300));
                    // A URL guardada tem hash de outra sessão — descartar
                    esquecerUrlApi();
                    reject(new Error('Sessão expirada ou URL incorreta. Faça login no eproc, execute uma pesquisa por nome, e tente novamente.'));
                    return;
                }
                try {
                    const json = JSON.parse(resposta);
                    if (json && json.resultados) {
                        resolve(normalizarResultados(json.resultados));
                    } else {
                        console.warn('[EPROC-FAV] Resposta sem resultados:', resposta.substring(0, 200));
                        resolve({ resultados: [], ignorados: 0 });
                    }
                } catch (e) {
                    console.error('[EPROC-FAV] Resposta não é JSON:', resposta.substring(0, 200));
                    esquecerUrlApi();
                    reject(new Error('Resposta inválida da API. Faça login no eproc, execute uma pesquisa por nome, e tente novamente.'));
                }
            };
            xhr.onerror = () => reject(new Error('Erro de rede ao consultar API'));
            xhr.ontimeout = () => reject(new Error('Timeout na consulta'));

            const body = new URLSearchParams({
                hdnInfraTipoPagina: parametros.hdnInfraTipoPagina || '1',
                strIdForm: parametros.strIdForm || 'frmProcessoListaAjax',
                acao: parametros.acao || 'pesquisa_processo_por_nome_parte',
                tipoPesquisa: parametros.tipoPesquisa || 'NO',
                strNomeParte: parametros.strNomeParte || '',
                numIdPessoa: parametros.numIdPessoa || '',
                divInfraAreaTabela_length: parametros.divInfraAreaTabela_length || '100'
            }).toString();
            xhr.send(body);
        });
    }

    // ==============================
    // FAVORITOS NA TABELA
    // ==============================
    // A estrela é injetada DENTRO da célula que já contém o número do processo.
    //
    // A versão anterior criava uma coluna nova (um <th> no cabeçalho + um <td> em cada
    // linha) e isso desalinhava a tabela do eproc: o <th> ia para uma única linha de
    // cabeçalho (`thead tr, tr:first-child` casa só a primeira), enquanto tabelas com
    // duas linhas de cabeçalho, com <colgroup>, ou com linhas de agrupamento/total
    // usando colspan ficavam com uma célula sobrando ou faltando. Sem coluna nova não
    // existe alinhamento para quebrar, seja qual for a estrutura da tabela.
    async function injetarEstrelasTabela() {
        const container = document.getElementById('divInfraAreaTabela');
        if (!container) return;
        const table = container.querySelector('table');
        if (!table || table.dataset.eprocFavProcessada) return;
        table.dataset.eprocFavProcessada = 'true';

        const processosAPI = (_ultimaConsulta && _ultimaConsulta.resultados) ? _ultimaConsulta.resultados : [];
        // Casar por NÚMERO, não por índice: índice quebra com linha de agrupamento,
        // linha oculta ou ordenação da tabela diferente da ordem do array da API —
        // e gravaria os dados de um processo sob o número de outro.
        const mapaAPI = new Map(
            processosAPI.filter(p => p && p.nr_processo).map(p => [p.nr_processo, p])
        );

        // Uma única leitura do banco em vez de uma transação por linha.
        const favoritos = new Set((await listarFavoritos()).map(p => p.numero));

        for (const row of table.rows) {
            if (row.querySelector('.eproc-fav-star')) continue;

            const dadosLinha = extrairDadosDaLinha(row);
            const numero = dadosLinha.nr_processo;
            if (!numero) continue; // cabeçalho, agrupamento, "nenhum registro" etc.

            // Preferir os dados ricos da API quando existirem para este número.
            const dadosCompletos = mapaAPI.get(numero) || dadosLinha;

            // Célula que contém o número — é lá que a estrela entra.
            const celula = [...row.cells].find(c => extrairNumeroProcesso(c.textContent)) || row.cells[0];
            if (!celula) continue;

            const star = document.createElement('span');
            star.className = `eproc-fav-star ${favoritos.has(numero) ? 'eproc-fav-star-ativo' : 'eproc-fav-star-inativo'}`;
            star.textContent = favoritos.has(numero) ? '★' : '☆';
            star.dataset.numero = numero;
            star.title = favoritos.has(numero) ? 'Remover dos favoritos' : 'Adicionar aos favoritos';

            star.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                try {
                    if (await obterProcesso(numero)) {
                        await removerProcesso(numero);
                        star.className = 'eproc-fav-star eproc-fav-star-inativo';
                        star.textContent = '☆';
                        star.title = 'Adicionar aos favoritos';
                        mostrarToast('Removido dos favoritos', 'info');
                    } else {
                        await salvarProcesso(prepararProcesso(dadosCompletos, _ultimosParametros));
                        star.className = 'eproc-fav-star eproc-fav-star-ativo';
                        star.textContent = '★';
                        star.title = 'Remover dos favoritos';
                        mostrarToast('Adicionado aos favoritos', 'sucesso');
                    }
                    await atualizarBadgeTrigger();
                } catch (err) {
                    console.warn('[EPROC-FAV] Erro ao favoritar:', err);
                    mostrarToast('Erro ao salvar favorito', 'erro');
                }
            });

            celula.insertBefore(star, celula.firstChild);
        }
    }

    // Re-processar quando nova consulta chega
    document.addEventListener('eproc-fav:consulta', () => {
        const container = document.getElementById('divInfraAreaTabela');
        if (container) {
            const table = container.querySelector('table');
            if (table) table.dataset.eprocFavProcessada = '';
        }
        setTimeout(() => injetarEstrelasTabela(), 300);
    });

    // ==============================
    // PAINEL LATERAL
    // ==============================
    let _sidebar = null;
    let _sidebarLista = null;

    function criarPainelLateral() {
        if (_sidebar) return;

        // Trigger button
        const trigger = document.createElement('div');
        trigger.className = 'eproc-fav-trigger';
        trigger.id = 'eproc-fav-trigger';
        trigger.innerHTML = '⭐ Favoritos';
        trigger.addEventListener('click', togglePainel);
        document.body.appendChild(trigger);

        // Sidebar
        _sidebar = document.createElement('div');
        _sidebar.className = 'eproc-fav-sidebar';
        _sidebar.innerHTML = `
            <div class="eproc-fav-sidebar-header">
                <h2>⭐ Processos Favoritos</h2>
                <button class="eproc-fav-sidebar-close" id="eproc-fav-fechar">&times;</button>
            </div>
            <div class="eproc-fav-sidebar-toolbar">
                <div style="position:relative;display:flex;align-items:center">
                    <input type="text" class="eproc-fav-input" id="eproc-fav-busca"
                           placeholder="Pesquisar por número, parte, assunto..."
                           style="padding-left:30px">
                    <span style="position:absolute;left:9px;top:50%;transform:translateY(-50%);color:#999;pointer-events:none">
                        ${SVG_SEARCH}
                    </span>
                </div>
                <div class="eproc-fav-sidebar-acoes">
                    <button class="eproc-fav-btn eproc-fav-btn-primary eproc-fav-btn-sm" id="eproc-fav-atualizar">
                        ${SVG_REFRESH} Atualizar
                    </button>
                    <button class="eproc-fav-btn eproc-fav-btn-success eproc-fav-btn-sm" id="eproc-fav-novo">
                        ${SVG_PLUS} Novo
                    </button>
                    <button class="eproc-fav-btn eproc-fav-btn-secondary eproc-fav-btn-sm eproc-fav-btn-icon" id="eproc-fav-config" title="Configurações">
                        ${SVG_SETTINGS}
                    </button>
                    <span class="eproc-fav-counter" id="eproc-fav-contador">0</span>
                </div>
                <div class="eproc-fav-sidebar-filtros" id="eproc-fav-filtros-tags"></div>
                <div class="eproc-fav-sidebar-filtros">
                    <span style="font-size:11px;color:#777;font-weight:600">Ordenar:</span>
                    <select class="eproc-fav-select" id="eproc-fav-ordenar" style="font-size:11px;padding:3px 6px">
                        <option value="ultimaAtualizacao">Última atualização</option>
                        <option value="numero">Número</option>
                        <option value="autor">Autor</option>
                        <option value="reu">Réu</option>
                        <option value="classe">Classe</option>
                        <option value="des_situacao">Situação</option>
                        <option value="ultimo_evento">Último evento</option>
                    </select>
                    <button class="eproc-fav-btn eproc-fav-btn-ghost eproc-fav-btn-icon" id="eproc-fav-direcao"
                            title="Alternar direção" style="padding:2px 5px;font-size:11px">
                        ${SVG_SORT}
                    </button>
                </div>
            </div>
            <div class="eproc-fav-sidebar-lista" id="eproc-fav-lista"></div>
            <div class="eproc-fav-sidebar-footer">
                <button class="eproc-fav-btn eproc-fav-btn-ghost eproc-fav-btn-sm" id="eproc-fav-consultas">
                    ${SVG_FOLDER} Consultas
                </button>
                <button class="eproc-fav-btn eproc-fav-btn-ghost eproc-fav-btn-sm" id="eproc-fav-exportar">
                    ${SVG_DOWNLOAD} Exportar
                </button>
                <button class="eproc-fav-btn eproc-fav-btn-ghost eproc-fav-btn-sm" id="eproc-fav-importar">
                    ${SVG_UPLOAD} Importar
                </button>
            </div>
        `;
        document.body.appendChild(_sidebar);
        _sidebarLista = document.getElementById('eproc-fav-lista');

        // Event listeners
        document.getElementById('eproc-fav-fechar').addEventListener('click', togglePainel);
        document.getElementById('eproc-fav-busca').addEventListener('input', debounce(function () {
            _termoBusca = this.value;
            renderizarPainel();
        }, 200));
        document.getElementById('eproc-fav-atualizar').addEventListener('click', atualizarFavoritos);
        document.getElementById('eproc-fav-novo').addEventListener('click', abrirModalNovoFavorito);
        document.getElementById('eproc-fav-config').addEventListener('click', abrirMenuConfig);
        // Refletir as preferências persistidas nos controles.
        const selOrdenar = document.getElementById('eproc-fav-ordenar');
        selOrdenar.value = _ordenacao.campo;
        atualizarIconeDirecao();

        selOrdenar.addEventListener('change', function () {
            _ordenacao.campo = this.value;
            salvarPrefs();
            renderizarPainel();
        });
        document.getElementById('eproc-fav-direcao').addEventListener('click', () => {
            _ordenacao.direcao = _ordenacao.direcao === 'asc' ? 'desc' : 'asc';
            salvarPrefs();
            atualizarIconeDirecao();
            renderizarPainel();
        });
        document.getElementById('eproc-fav-consultas').addEventListener('click', abrirModalConsultasSalvas);
        document.getElementById('eproc-fav-exportar').addEventListener('click', exportarBackup);
        document.getElementById('eproc-fav-importar').addEventListener('click', importarBackup);
    }

    // O SVG_SORT é simétrico (setas para cima e para baixo), então sozinho não indica
    // a direção atual. Rotacionar deixa o estado visível.
    function atualizarIconeDirecao() {
        const btn = document.getElementById('eproc-fav-direcao');
        if (!btn) return;
        const asc = _ordenacao.direcao === 'asc';
        btn.style.transform = asc ? 'rotate(180deg)' : 'none';
        btn.title = asc ? 'Ordem crescente — clique para inverter'
                        : 'Ordem decrescente — clique para inverter';
    }

    function togglePainel() {
        _painelAberto = !_painelAberto;
        if (_painelAberto) {
            _sidebar.classList.add('eproc-fav-aberto');
            renderizarPainel();
        } else {
            _sidebar.classList.remove('eproc-fav-aberto');
        }
    }

    // Chamada em vários pontos sem await; trata o próprio erro para não gerar
    // unhandled rejection invisível caso o IndexedDB falhe.
    async function atualizarBadgeTrigger() {
        const trigger = document.getElementById('eproc-fav-trigger');
        if (!trigger) return;
        try {
            const processos = await listarFavoritos();
            const novos = processos.filter(p => p.novo);
            const badgeExistente = trigger.querySelector('.eproc-fav-trigger-badge');
            if (badgeExistente) badgeExistente.remove();
            if (novos.length > 0) {
                const badge = document.createElement('span');
                badge.className = 'eproc-fav-trigger-badge';
                badge.textContent = novos.length;
                trigger.appendChild(badge);
            }
        } catch (e) {
            console.warn('[EPROC-FAV] Falha ao atualizar badge:', e);
        }
    }

    async function renderizarPainel() {
        if (!_sidebarLista) return;

        let processos;
        try {
            processos = await listarFavoritos();
        } catch (e) {
            console.warn('[EPROC-FAV] Falha ao ler favoritos:', e);
            _sidebarLista.textContent = 'Erro ao ler o banco local. Recarregue a página.';
            return;
        }

        // Filtrar por busca
        if (_termoBusca) {
            const termo = normalizarBusca(_termoBusca);
            processos = processos.filter(p => {
                const campos = [
                    p.numero, p.nr_processo, p.autor, p.reu,
                    p.des_assuntos, p.observacoes,
                    ...(p.tags || [])
                ].filter(Boolean).join(' ');
                return normalizarBusca(campos).includes(termo);
            });
        }

        // Filtrar por etiqueta
        if (_filtroEtiqueta) {
            processos = processos.filter(p => p.tags && p.tags.includes(_filtroEtiqueta));
        }

        // Ordenar
        processos = ordenarProcessos(processos, _ordenacao.campo, _ordenacao.direcao);

        // Atualizar contador
        const contador = document.getElementById('eproc-fav-contador');
        if (contador) contador.textContent = processos.length;

        // Renderizar filtros de etiqueta
        await renderizarFiltrosTags();

        // Renderizar lista
        _sidebarLista.innerHTML = '';
        if (processos.length === 0) {
            _sidebarLista.innerHTML = `<div class="eproc-fav-sidebar-vazio">
                ${_termoBusca || _filtroEtiqueta ? 'Nenhum processo encontrado com este filtro' : 'Nenhum processo favoritado ainda.<br><br>Use o botão <strong>Novo</strong> para buscar e adicionar processos, ou clique ☆ na tabela de resultados do eproc.'}
            </div>`;
            return;
        }

        for (const proc of processos) {
            _sidebarLista.appendChild(criarCardProcesso(proc));
        }
    }

    async function renderizarFiltrosTags() {
        const container = document.getElementById('eproc-fav-filtros-tags');
        if (!container) return;
        const etiquetas = await listarEtiquetas();
        container.innerHTML = '';
        if (etiquetas.length === 0) return;

        const btnTodos = document.createElement('span');
        btnTodos.className = `eproc-fav-tag eproc-fav-tag-filter ${!_filtroEtiqueta ? 'eproc-fav-tag-active' : ''}`;
        btnTodos.style.cssText = 'background:#607d8b;font-size:10px';
        btnTodos.textContent = 'Todos';
        btnTodos.addEventListener('click', () => {
            _filtroEtiqueta = null;
            salvarPrefs();
            renderizarPainel();
        });
        container.appendChild(btnTodos);

        for (const et of etiquetas) {
            const cor = et.cor || corEtiqueta(et.nome);
            const chip = document.createElement('span');
            chip.className = `eproc-fav-tag eproc-fav-tag-filter ${_filtroEtiqueta === et.nome ? 'eproc-fav-tag-active' : ''}`;
            chip.style.background = cor;
            chip.textContent = et.nome;
            chip.addEventListener('click', () => {
                _filtroEtiqueta = _filtroEtiqueta === et.nome ? null : et.nome;
                salvarPrefs();
                renderizarPainel();
            });
            container.appendChild(chip);
        }
    }

    function criarCardProcesso(proc) {
        const card = document.createElement('div');
        card.className = 'eproc-fav-card';

        // Topo: estrela + número + badge
        const top = document.createElement('div');
        top.className = 'eproc-fav-card-top';

        const starSpan = document.createElement('span');
        starSpan.className = 'eproc-fav-card-star';
        starSpan.textContent = '★';
        starSpan.title = 'Remover dos favoritos';
        starSpan.addEventListener('click', async () => {
            const sim = await confirmar(`Remover processo ${proc.numero} dos favoritos?`);
            if (sim) {
                await removerProcesso(proc.numero);
                mostrarToast('Removido dos favoritos', 'info');
                renderizarPainel();
                atualizarBadgeTrigger();
            }
        });

        const numContainer = document.createElement('span');

        // Número clicável — busca link fresco via API (hash válido na sessão atual)
        const numLink = document.createElement('a');
        numLink.className = 'eproc-fav-card-numero';
        numLink.textContent = proc.numero || proc.nr_processo || '—';
        numLink.href = 'javascript:void(0)';
        numLink.title = 'Clique para abrir o processo';
        numLink.addEventListener('click', async (e) => {
            e.preventDefault();
            await abrirProcesso(proc);
        });

        numContainer.appendChild(numLink);
        if (proc.novo) {
            const badge = document.createElement('span');
            badge.className = 'eproc-fav-card-badge-novo';
            badge.textContent = '🆕 ATUALIZADO';
            numContainer.appendChild(badge);
        }

        top.append(starSpan, numContainer);
        card.appendChild(top);

        // FIX 3: Indicador de dados incompletos
        if (processoIncompleto(proc)) {
            const aviso = document.createElement('div');
            aviso.className = 'eproc-fav-card-incompleto';
            aviso.textContent = '⚠ Dados incompletos — clique em "Atualizar" no topo para buscar informações';
            card.appendChild(aviso);
        }

        // Partes
        if (proc.autor || proc.reu) {
            const partes = document.createElement('div');
            partes.className = 'eproc-fav-card-partes';
            let html = '';
            if (proc.autor) html += `<strong>Autor:</strong> ${proc.autor}<br>`;
            if (proc.reu) html += `<strong>Réu:</strong> ${proc.reu}`;
            partes.innerHTML = html;
            card.appendChild(partes);
        }

        // Classe, Juízo, Situação
        const infoParts = [];
        if (proc.classe) infoParts.push(`<span><strong>Classe:</strong> ${proc.classe}</span>`);
        if (proc.str_sig_orgao_juizo) infoParts.push(`<span><strong>Juízo:</strong> ${proc.str_sig_orgao_juizo}</span>`);
        if (proc.des_situacao) infoParts.push(`<span><strong>Situação:</strong> ${proc.des_situacao}</span>`);
        if (infoParts.length) {
            const info = document.createElement('div');
            info.className = 'eproc-fav-card-info';
            info.innerHTML = infoParts.join('');
            card.appendChild(info);
        }

        // Último evento
        if (proc.ultimo_evento) {
            const evento = document.createElement('div');
            evento.className = 'eproc-fav-card-evento';
            evento.textContent = proc.ultimo_evento;
            card.appendChild(evento);
        }

        // Tags
        if (proc.tags && proc.tags.length > 0) {
            const tagsDiv = document.createElement('div');
            tagsDiv.className = 'eproc-fav-card-tags';
            proc.tags.forEach(tag => {
                const chip = document.createElement('span');
                chip.className = 'eproc-fav-tag';
                chip.style.background = corEtiqueta(tag);
                chip.textContent = tag;
                tagsDiv.appendChild(chip);
            });
            card.appendChild(tagsDiv);
        }

        // Observações (preview)
        if (proc.observacoes) {
            const obs = document.createElement('div');
            obs.className = 'eproc-fav-card-obs';
            obs.textContent = proc.observacoes.length > 120
                ? proc.observacoes.substring(0, 120) + '...'
                : proc.observacoes;
            card.appendChild(obs);
        }

        // Ações
        const acoes = document.createElement('div');
        acoes.className = 'eproc-fav-card-acoes';
        acoes.innerHTML = `
            <button class="eproc-fav-btn eproc-fav-btn-primary eproc-fav-btn-sm" data-acao="abrir">${SVG_OPEN} Abrir</button>
            <button class="eproc-fav-btn eproc-fav-btn-secondary eproc-fav-btn-sm" data-acao="obs">${SVG_NOTE} Obs</button>
            <button class="eproc-fav-btn eproc-fav-btn-secondary eproc-fav-btn-sm" data-acao="tags">${SVG_TAG} Tags</button>
            <button class="eproc-fav-btn eproc-fav-btn-danger eproc-fav-btn-sm" data-acao="excluir">${SVG_TRASH}</button>
        `;

        acoes.querySelector('[data-acao="abrir"]').addEventListener('click', () => {
            abrirProcesso(proc);
        });
        acoes.querySelector('[data-acao="obs"]').addEventListener('click', () => abrirModalObservacoes(proc.numero));
        acoes.querySelector('[data-acao="tags"]').addEventListener('click', () => abrirModalEtiquetas(proc.numero));
        acoes.querySelector('[data-acao="excluir"]').addEventListener('click', async () => {
            const sim = await confirmar(`Remover processo ${proc.numero} dos favoritos?`);
            if (sim) {
                await removerProcesso(proc.numero);
                mostrarToast('Processo removido', 'info');
                renderizarPainel();
                atualizarBadgeTrigger();
            }
        });

        card.appendChild(acoes);
        return card;
    }

    // ==============================
    // OBSERVAÇÕES
    // ==============================
    async function abrirModalObservacoes(numero) {
        const proc = await obterProcesso(numero);
        if (!proc) { mostrarToast('Processo não encontrado', 'erro'); return; }

        const { body, footer, fechar } = criarModal(`📝 Observações - ${numero}`, 520);
        body.innerHTML = `
            <textarea class="eproc-fav-textarea" id="eproc-fav-obs-texto"
                      placeholder="Digite suas observações sobre este processo..."
                      style="min-height:150px">${proc.observacoes || ''}</textarea>
        `;
        footer.innerHTML = `
            <button class="eproc-fav-btn eproc-fav-btn-secondary" data-acao="cancelar">Cancelar</button>
            <button class="eproc-fav-btn eproc-fav-btn-success" data-acao="salvar">${SVG_NOTE} Salvar</button>
        `;
        footer.querySelector('[data-acao="cancelar"]').onclick = fechar;
        footer.querySelector('[data-acao="salvar"]').onclick = async () => {
            proc.observacoes = document.getElementById('eproc-fav-obs-texto').value.trim();
            await salvarProcesso(proc);
            mostrarToast('Observações salvas', 'sucesso');
            fechar();
            if (_painelAberto) renderizarPainel();
        };
    }

    // ==============================
    // ETIQUETAS
    // ==============================
    async function abrirModalEtiquetas(numero) {
        const proc = await obterProcesso(numero);
        if (!proc) { mostrarToast('Processo não encontrado', 'erro'); return; }

        const { body, footer, fechar } = criarModal(`🏷️ Etiquetas - ${numero}`, 450);

        async function renderConteudo() {
            const etiquetas = await listarEtiquetas();
            body.innerHTML = '';

            const novaRow = document.createElement('div');
            novaRow.style.cssText = 'display:flex;gap:6px;align-items:center';
            novaRow.innerHTML = `
                <input type="text" class="eproc-fav-input" id="eproc-fav-nova-tag"
                       placeholder="Nova etiqueta..." style="flex:1">
                <button class="eproc-fav-btn eproc-fav-btn-primary eproc-fav-btn-sm" id="eproc-fav-add-tag">
                    ${SVG_PLUS} Criar
                </button>
            `;
            body.appendChild(novaRow);

            novaRow.querySelector('#eproc-fav-add-tag').addEventListener('click', async () => {
                const nome = document.getElementById('eproc-fav-nova-tag').value.trim();
                if (!nome) return;
                await salvarEtiqueta({ nome, cor: corEtiqueta(nome) });
                if (!proc.tags) proc.tags = [];
                if (!proc.tags.includes(nome)) proc.tags.push(nome);
                await salvarProcesso(proc);
                renderConteudo();
            });

            if (etiquetas.length === 0) {
                body.appendChild(Object.assign(document.createElement('div'), {
                    className: 'eproc-fav-empty',
                    textContent: 'Nenhuma etiqueta criada. Digite acima para criar.'
                }));
            } else {
                const lista = document.createElement('div');
                lista.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin-top:4px';
                etiquetas.forEach(et => {
                    const cor = et.cor || corEtiqueta(et.nome);
                    const ativa = proc.tags && proc.tags.includes(et.nome);
                    const chip = document.createElement('span');
                    chip.className = 'eproc-fav-tag';
                    chip.style.cssText = `background:${ativa ? cor : '#e0e0e0'};color:${ativa ? 'white' : '#666'};cursor:pointer;padding:4px 10px;font-size:12px`;
                    chip.textContent = et.nome;
                    chip.title = ativa ? 'Clique para remover' : 'Clique para adicionar';
                    chip.addEventListener('click', async () => {
                        if (!proc.tags) proc.tags = [];
                        if (ativa) {
                            proc.tags = proc.tags.filter(t => t !== et.nome);
                        } else {
                            proc.tags.push(et.nome);
                        }
                        await salvarProcesso(proc);
                        renderConteudo();
                    });
                    lista.appendChild(chip);
                });
                body.appendChild(lista);
            }
        }

        await renderConteudo();

        footer.innerHTML = `
            <button class="eproc-fav-btn eproc-fav-btn-ghost eproc-fav-btn-sm" data-acao="gerenciar">
                ${SVG_SETTINGS} Gerenciar
            </button>
            <button class="eproc-fav-btn eproc-fav-btn-secondary" data-acao="fechar">Fechar</button>
        `;
        footer.querySelector('[data-acao="fechar"]').onclick = () => { fechar(); if (_painelAberto) renderizarPainel(); };
        footer.querySelector('[data-acao="gerenciar"]').onclick = () => { fechar(); abrirGerenciadorEtiquetas(); };
    }

    async function abrirGerenciadorEtiquetas() {
        const { body, footer, fechar } = criarModal('🏷️ Gerenciar Etiquetas', 450);

        async function renderLista() {
            const atuais = await listarEtiquetas();
            body.innerHTML = '';

            const novaRow = document.createElement('div');
            novaRow.style.cssText = 'display:flex;gap:6px;align-items:center';
            novaRow.innerHTML = `
                <input type="text" class="eproc-fav-input" id="eproc-fav-ger-nova"
                       placeholder="Nome da etiqueta..." style="flex:1">
                <button class="eproc-fav-btn eproc-fav-btn-success eproc-fav-btn-sm" id="eproc-fav-ger-add">
                    ${SVG_PLUS} Criar
                </button>
            `;
            body.appendChild(novaRow);

            novaRow.querySelector('#eproc-fav-ger-add').addEventListener('click', async () => {
                const nome = document.getElementById('eproc-fav-ger-nova').value.trim();
                if (!nome) return;
                await salvarEtiqueta({ nome, cor: corEtiqueta(nome) });
                renderLista();
            });

            if (atuais.length === 0) {
                body.appendChild(Object.assign(document.createElement('div'), {
                    className: 'eproc-fav-empty', textContent: 'Nenhuma etiqueta'
                }));
                return;
            }

            const lista = document.createElement('div');
            lista.className = 'eproc-fav-list';
            lista.style.maxHeight = '300px';
            atuais.forEach(et => {
                const cor = et.cor || corEtiqueta(et.nome);
                const item = document.createElement('div');
                item.className = 'eproc-fav-list-item';
                item.innerHTML = `
                    <span class="eproc-fav-tag" style="background:${cor}">${et.nome}</span>
                    <div class="eproc-fav-list-item-acoes" style="opacity:1">
                        <button class="eproc-fav-btn eproc-fav-btn-danger eproc-fav-btn-sm eproc-fav-btn-icon"
                                title="Excluir">${SVG_TRASH}</button>
                    </div>
                `;
                item.querySelector('button').addEventListener('click', async () => {
                    const sim = await confirmar(`Excluir etiqueta "${et.nome}"? Será removida de todos os processos.`);
                    if (sim) {
                        await removerEtiqueta(et.nome);
                        const processos = await listarFavoritos();
                        for (const p of processos) {
                            if (p.tags && p.tags.includes(et.nome)) {
                                p.tags = p.tags.filter(t => t !== et.nome);
                                await salvarProcesso(p);
                            }
                        }
                        renderLista();
                    }
                });
                lista.appendChild(item);
            });
            body.appendChild(lista);
        }

        await renderLista();
        footer.innerHTML = '<button class="eproc-fav-btn eproc-fav-btn-secondary" data-acao="fechar">Fechar</button>';
        footer.querySelector('[data-acao="fechar"]').onclick = () => { fechar(); if (_painelAberto) renderizarPainel(); };
    }

    // ==============================
    // ORDENAÇÃO
    // ==============================
    function ordenarProcessos(processos, campo, direcao) {
        const dir = direcao === 'asc' ? 1 : -1;
        return [...processos].sort((a, b) => {
            if (campo === 'ultimaAtualizacao') {
                return ((a.ultimaAtualizacao || 0) - (b.ultimaAtualizacao || 0)) * dir;
            }
            const va = (a[campo] || '').toString().toLowerCase();
            const vb = (b[campo] || '').toString().toLowerCase();
            return va.localeCompare(vb) * dir;
        });
    }

    // ==============================
    // ATUALIZAÇÃO
    // ==============================
    async function atualizarFavoritos() {
        const processos = await listarFavoritos();
        if (processos.length === 0) {
            mostrarToast('Nenhum favorito para atualizar', 'info');
            return;
        }

        // Agrupar por consulta (strNomeParte)
        const grupos = {};
        const semConsulta = [];
        for (const p of processos) {
            if (p._consulta && p._consulta.strNomeParte) {
                const chave = p._consulta.strNomeParte;
                if (!grupos[chave]) grupos[chave] = { parametros: p._consulta, processos: [] };
                grupos[chave].processos.push(p);
            } else {
                semConsulta.push(p);
            }
        }

        const chaves = Object.keys(grupos);
        if (chaves.length === 0) {
            mostrarToast(
                `${processos.length} favorito(s) sem dados de consulta. ` +
                'Adicione processos pelo botão "Novo" para que possam ser atualizados.',
                'info'
            );
            return;
        }

        // Modal de progresso
        const { body, footer, fechar } = criarModal('🔄 Atualizando favoritos...', 450);
        footer.style.display = 'none';
        body.innerHTML = `
            <div class="eproc-fav-progress-track">
                <div class="eproc-fav-progress-bar" id="eproc-fav-prog-bar" style="width:0%"></div>
            </div>
            <p id="eproc-fav-prog-texto" style="font-size:12px;color:#555;margin:4px 0 0">Iniciando...</p>
            <div id="eproc-fav-prog-log" style="font-size:11px;color:#888;max-height:150px;overflow-y:auto;margin-top:6px"></div>
        `;

        const barEl = document.getElementById('eproc-fav-prog-bar');
        const textoEl = document.getElementById('eproc-fav-prog-texto');
        const logEl = document.getElementById('eproc-fav-prog-log');
        let atualizados = 0;
        let erros = 0;

        // textContent em vez de innerHTML += : o nome da parte e a mensagem de erro
        // são dados externos, e concatenar innerHTML reparseia o log inteiro por item.
        const logLinha = (texto, cor) => {
            const div = document.createElement('div');
            div.textContent = texto;
            if (cor) div.style.color = cor;
            logEl.appendChild(div);
            logEl.scrollTop = logEl.scrollHeight;
        };

        for (let i = 0; i < chaves.length; i++) {
            const chave = chaves[i];
            const grupo = grupos[chave];
            textoEl.textContent = `Consultando: ${chave} (${i + 1}/${chaves.length})`;
            barEl.style.width = `${((i) / chaves.length) * 100}%`;

            try {
                const resultado = await executarConsultaAPI(grupo.parametros);
                if (resultado && resultado.resultados) {
                    for (const apiObj of resultado.resultados) {
                        const existente = grupo.processos.find(p => p.numero === apiObj.nr_processo);
                        if (existente) {
                            const atualizado = mesclarProcesso(existente, apiObj);
                            await salvarProcesso(atualizado);
                            if (atualizado.novo) atualizados++;
                            logLinha(`✓ ${apiObj.nr_processo}${atualizado.novo ? ' (alterado)' : ''}`);
                        }
                    }
                }
            } catch (e) {
                erros++;
                logLinha(`✗ Erro em "${chave}": ${e.message}`, '#c62828');
                console.warn('[EPROC-FAV] Erro ao atualizar:', chave, e);
            }

            await sleep(500);
        }

        barEl.style.width = '100%';

        let msgFinal = `Concluído! ${atualizados} processo(s) com alterações.`;
        if (erros > 0) msgFinal += ` ${erros} consulta(s) com erro.`;
        if (semConsulta.length > 0) msgFinal += ` ${semConsulta.length} favorito(s) sem dados de consulta (não atualizados).`;
        textoEl.textContent = msgFinal;

        footer.style.display = 'flex';
        footer.innerHTML = '<button class="eproc-fav-btn eproc-fav-btn-primary" data-acao="ok">OK</button>';
        footer.querySelector('[data-acao="ok"]').onclick = () => {
            fechar();
            renderizarPainel();
            atualizarBadgeTrigger();
        };
    }

    // ==============================
    // MODAL NOVO FAVORITO
    // ==============================
    async function abrirModalNovoFavorito() {
        const { body, footer, fechar } = criarModal('➕ Adicionar Favorito', 580);

        body.innerHTML = `
            <div class="eproc-fav-label">Buscar por nome da parte:</div>
            <div style="display:flex;gap:6px;align-items:center">
                <input type="text" class="eproc-fav-input" id="eproc-fav-novo-busca"
                       placeholder="Ex: JOÃO DA SILVA, EMPRESA LTDA..." style="flex:1">
                <button class="eproc-fav-btn eproc-fav-btn-primary eproc-fav-btn-sm" id="eproc-fav-novo-pesquisar">
                    ${SVG_SEARCH} Buscar
                </button>
            </div>
            <div id="eproc-fav-novo-status" style="font-size:11px;color:#888;min-height:16px"></div>
            <div id="eproc-fav-novo-resultados" style="max-height:350px;overflow-y:auto"></div>
        `;

        const inputBusca = body.querySelector('#eproc-fav-novo-busca');
        const btnPesquisar = body.querySelector('#eproc-fav-novo-pesquisar');
        const divResultados = body.querySelector('#eproc-fav-novo-resultados');
        const divStatus = body.querySelector('#eproc-fav-novo-status');

        async function pesquisar() {
            const nome = inputBusca.value.trim();
            if (!nome) { mostrarToast('Digite o nome da parte', 'info'); return; }

            btnPesquisar.disabled = true;
            btnPesquisar.innerHTML = '<span class="eproc-fav-spinner eproc-fav-spinner-sm"></span>';
            divResultados.innerHTML = '<div class="eproc-fav-empty"><span class="eproc-fav-spinner"></span><br>Consultando API do eproc...</div>';
            divStatus.textContent = `Buscando "${nome}"...`;

            try {
                const params = { strNomeParte: nome, tipoPesquisa: 'NO' };
                const resultado = await executarConsultaAPI(params);

                if (!resultado || !resultado.resultados || resultado.resultados.length === 0) {
                    divResultados.innerHTML = '<div class="eproc-fav-empty">Nenhum processo encontrado para este nome.</div>';
                    divStatus.textContent = '0 resultados';
                    return;
                }

                divStatus.innerHTML = `${resultado.resultados.length} resultado(s) — clique ☆ para favoritar`;
                divResultados.innerHTML = '';

                for (const apiObj of resultado.resultados) {
                    const existente = await obterProcesso(apiObj.nr_processo);
                    const item = document.createElement('div');
                    item.className = 'eproc-fav-resultado';
                    item.innerHTML = `
                        <span class="eproc-fav-star ${existente ? 'eproc-fav-star-ativo' : 'eproc-fav-star-inativo'}"
                              style="font-size:22px;flex-shrink:0;cursor:pointer;padding:2px">${existente ? '★' : '☆'}</span>
                        <div class="eproc-fav-resultado-info">
                            <div class="eproc-fav-resultado-num">${apiObj.nr_processo}</div>
                            <div><strong>Autor:</strong> ${apiObj.autor || '—'}</div>
                            <div><strong>Réu:</strong> ${apiObj.reu || '—'}</div>
                            <div style="color:#777">${apiObj.classe || ''} | ${apiObj.str_sig_orgao_juizo || ''} | ${apiObj.des_situacao || ''}</div>
                        </div>
                    `;

                    const star = item.querySelector('.eproc-fav-star');
                    star.addEventListener('click', async () => {
                        const proc = await obterProcesso(apiObj.nr_processo);
                        if (proc) {
                            await removerProcesso(apiObj.nr_processo);
                            star.className = 'eproc-fav-star eproc-fav-star-inativo';
                            star.textContent = '☆';
                            mostrarToast('Removido dos favoritos', 'info');
                        } else {
                            const novoProc = prepararProcesso(apiObj, params);
                            await salvarProcesso(novoProc);
                            star.className = 'eproc-fav-star eproc-fav-star-ativo';
                            star.textContent = '★';
                            mostrarToast(`Favoritado: ${apiObj.nr_processo}`, 'sucesso');
                        }
                        atualizarBadgeTrigger();
                    });

                    divResultados.appendChild(item);
                }
            } catch (e) {
                divResultados.innerHTML = `<div class="eproc-fav-empty" style="color:#c62828">
                    <strong>Erro ao consultar API</strong><br>
                    ${e.message}<br><br>
                    <span style="font-size:11px;color:#888">Verifique se você está logado no eproc e tente novamente.</span>
                </div>`;
                divStatus.textContent = 'Erro na consulta';
                console.error('[EPROC-FAV] Erro na busca:', e);
            } finally {
                btnPesquisar.disabled = false;
                btnPesquisar.innerHTML = `${SVG_SEARCH} Buscar`;
            }
        }

        btnPesquisar.addEventListener('click', pesquisar);
        inputBusca.addEventListener('keydown', (e) => { if (e.key === 'Enter') pesquisar(); });
        // Auto-focus no input
        setTimeout(() => inputBusca.focus(), 200);

        footer.innerHTML = `
            <button class="eproc-fav-btn eproc-fav-btn-ghost eproc-fav-btn-sm" data-acao="salvar-consulta">
                ${SVG_SAVE} Salvar consulta
            </button>
            <button class="eproc-fav-btn eproc-fav-btn-secondary" data-acao="fechar">Fechar</button>
        `;

        // FIX 1: Botão dedicado para salvar a consulta
        footer.querySelector('[data-acao="salvar-consulta"]').addEventListener('click', async () => {
            const nome = inputBusca.value.trim();
            if (!nome) { mostrarToast('Faça uma busca primeiro', 'info'); return; }
            await salvarConsulta({
                nome: nome,
                parametros: { strNomeParte: nome, tipoPesquisa: 'NO' },
                dataCriacao: Date.now()
            });
            mostrarToast(`Consulta "${nome}" salva! Acesse em Consultas no rodapé do painel.`, 'sucesso');
        });

        footer.querySelector('[data-acao="fechar"]').onclick = () => {
            fechar();
            if (_painelAberto) renderizarPainel();
        };
    }

    // ==============================
    // MENU DE CONFIGURAÇÕES
    // ==============================
    function abrirMenuConfig() {
        const { body, footer, fechar } = criarModal('⚙️ Configurações', 380);
        body.innerHTML = `
            <button class="eproc-fav-btn eproc-fav-btn-secondary" data-acao="etiquetas"
                    style="width:100%;justify-content:flex-start">
                ${SVG_TAG} Gerenciar Etiquetas
            </button>
            <button class="eproc-fav-btn eproc-fav-btn-secondary" data-acao="consultas"
                    style="width:100%;justify-content:flex-start">
                ${SVG_FOLDER} Consultas Salvas
            </button>
            <hr class="eproc-fav-divider">
            <button class="eproc-fav-btn eproc-fav-btn-secondary" data-acao="exportar"
                    style="width:100%;justify-content:flex-start">
                ${SVG_DOWNLOAD} Exportar Backup (JSON)
            </button>
            <button class="eproc-fav-btn eproc-fav-btn-secondary" data-acao="importar"
                    style="width:100%;justify-content:flex-start">
                ${SVG_UPLOAD} Importar Backup (JSON)
            </button>
        `;
        body.querySelector('[data-acao="etiquetas"]').onclick = () => { fechar(); abrirGerenciadorEtiquetas(); };
        body.querySelector('[data-acao="consultas"]').onclick = () => { fechar(); abrirModalConsultasSalvas(); };
        body.querySelector('[data-acao="exportar"]').onclick = () => { fechar(); exportarBackup(); };
        body.querySelector('[data-acao="importar"]').onclick = () => { fechar(); importarBackup(); };
        footer.innerHTML = '<button class="eproc-fav-btn eproc-fav-btn-secondary" data-acao="fechar">Fechar</button>';
        footer.querySelector('[data-acao="fechar"]').onclick = fechar;
    }

    // ==============================
    // CONSULTAS SALVAS
    // ==============================
    async function abrirModalConsultasSalvas() {
        const { body, footer, fechar } = criarModal('📂 Consultas Salvas', 500);

        async function renderLista() {
            const consultas = await listarConsultas();
            body.innerHTML = '';

            if (consultas.length === 0) {
                body.innerHTML = `<div class="eproc-fav-empty">
                    Nenhuma consulta salva.<br><br>
                    Você pode salvar consultas de duas formas:<br>
                    1. Clique <strong>"Novo"</strong> → busque → clique <strong>"Salvar consulta"</strong><br>
                    2. Quando o eproc pesquisar por nome, aparece um toast com <strong>"Salvar consulta"</strong>
                </div>`;
                return;
            }

            const lista = document.createElement('div');
            lista.className = 'eproc-fav-list';
            lista.style.maxHeight = '400px';

            consultas.forEach(c => {
                const item = document.createElement('div');
                item.className = 'eproc-fav-list-item';
                item.innerHTML = `
                    <span style="flex:1">
                        <strong style="font-size:13px;color:#1565c0">${c.nome}</strong>
                        <br><span style="font-size:11px;color:#888">Salva em ${new Date(c.dataCriacao).toLocaleDateString('pt-BR')}</span>
                    </span>
                    <div class="eproc-fav-list-item-acoes" style="opacity:1;gap:4px">
                        <button class="eproc-fav-btn eproc-fav-btn-primary eproc-fav-btn-sm" data-acao="executar"
                                title="Executar consulta">${SVG_SEARCH} Executar</button>
                        <button class="eproc-fav-btn eproc-fav-btn-danger eproc-fav-btn-sm eproc-fav-btn-icon" data-acao="excluir"
                                title="Excluir">${SVG_TRASH}</button>
                    </div>
                `;

                item.querySelector('[data-acao="executar"]').addEventListener('click', () => {
                    fechar();
                    abrirModalResultadoConsulta(c);
                });

                item.querySelector('[data-acao="excluir"]').addEventListener('click', async () => {
                    const sim = await confirmar(`Excluir consulta "${c.nome}"?`);
                    if (sim) {
                        await removerConsulta(c.id);
                        mostrarToast('Consulta excluída', 'info');
                        renderLista();
                    }
                });

                lista.appendChild(item);
            });

            body.appendChild(lista);
        }

        await renderLista();
        footer.innerHTML = '<button class="eproc-fav-btn eproc-fav-btn-secondary" data-acao="fechar">Fechar</button>';
        footer.querySelector('[data-acao="fechar"]').onclick = fechar;
    }

    async function abrirModalResultadoConsulta(consulta) {
        const { body, footer, fechar } = criarModal(`🔍 Resultados: ${consulta.nome}`, 580);
        body.innerHTML = '<div class="eproc-fav-empty"><span class="eproc-fav-spinner"></span><br>Consultando API...</div>';

        try {
            const resultado = await executarConsultaAPI(consulta.parametros);
            const aviso = resultado && resultado.ignorados
                ? ` — ${resultado.ignorados} sem número de processo (não exibidos)`
                : '';
            if (!resultado || !resultado.resultados || resultado.resultados.length === 0) {
                body.innerHTML = `<div class="eproc-fav-empty">Nenhum resultado encontrado${aviso}</div>`;
            } else {
                body.innerHTML = `<div style="font-size:11px;color:#888;margin-bottom:4px">${resultado.resultados.length} resultado(s) — clique ☆ para favoritar${aviso}</div>`;
                const container = document.createElement('div');
                container.style.cssText = 'max-height:400px;overflow-y:auto';

                for (const apiObj of resultado.resultados) {
                    const existente = await obterProcesso(apiObj.nr_processo);
                    const item = document.createElement('div');
                    item.className = 'eproc-fav-resultado';
                    item.innerHTML = `
                        <span class="eproc-fav-star ${existente ? 'eproc-fav-star-ativo' : 'eproc-fav-star-inativo'}"
                              style="font-size:22px;flex-shrink:0;cursor:pointer;padding:2px">${existente ? '★' : '☆'}</span>
                        <div class="eproc-fav-resultado-info">
                            <div class="eproc-fav-resultado-num">${apiObj.nr_processo}</div>
                            <div><strong>Autor:</strong> ${apiObj.autor || '—'}</div>
                            <div><strong>Réu:</strong> ${apiObj.reu || '—'}</div>
                            <div style="color:#777">${apiObj.classe || ''} | ${apiObj.str_sig_orgao_juizo || ''} | ${apiObj.des_situacao || ''}</div>
                        </div>
                    `;

                    const star = item.querySelector('.eproc-fav-star');
                    star.addEventListener('click', async () => {
                        const proc = await obterProcesso(apiObj.nr_processo);
                        if (proc) {
                            await removerProcesso(apiObj.nr_processo);
                            star.className = 'eproc-fav-star eproc-fav-star-inativo';
                            star.textContent = '☆';
                        } else {
                            await salvarProcesso(prepararProcesso(apiObj, consulta.parametros));
                            star.className = 'eproc-fav-star eproc-fav-star-ativo';
                            star.textContent = '★';
                        }
                        atualizarBadgeTrigger();
                    });
                    container.appendChild(item);
                }
                body.appendChild(container);
            }
        } catch (e) {
            body.innerHTML = `<div class="eproc-fav-empty" style="color:#c62828">
                <strong>Erro ao executar consulta</strong><br>${e.message}
            </div>`;
        }

        footer.innerHTML = '<button class="eproc-fav-btn eproc-fav-btn-secondary" data-acao="fechar">Fechar</button>';
        footer.querySelector('[data-acao="fechar"]').onclick = () => { fechar(); if (_painelAberto) renderizarPainel(); };
    }

    // ==============================
    // TELA DA CAPA DO PROCESSO
    // ==============================
    function ehTelaCapa() {
        const href = location.href;
        return href.includes('acao=processo_selecionar') || href.includes('acao=processo_consultar');
    }

    async function injetarBotoesCapa() {
        if (!ehTelaCapa()) return;
        if (document.getElementById('eproc-fav-capa-acoes')) return;

        // Procurar número do processo em vários seletores possíveis do eproc
        let numero = null;
        let numEl = null;
        const seletores = [
            '#txtNumProcesso',
            '.infraNomeCabecalho',
            '#divInfraBarraSuperior span',
            '.navbar-brand',
            'title'
        ];

        for (const sel of seletores) {
            const el = sel === 'title' ? document.querySelector('title') : document.querySelector(sel);
            if (el) {
                const n = extrairNumeroProcesso(el.textContent);
                if (n) {
                    numero = n;
                    numEl = sel === 'title' ? null : el;
                    break;
                }
            }
        }

        // Também tentar no título da página
        if (!numero) {
            numero = extrairNumeroProcesso(document.title);
        }

        if (!numero) return;

        const container = document.createElement('span');
        container.className = 'eproc-fav-capa-acoes';
        container.id = 'eproc-fav-capa-acoes';

        const proc = await obterProcesso(numero);

        // Botão Favoritar
        const btnFav = document.createElement('button');
        btnFav.className = `eproc-fav-capa-btn ${proc ? 'eproc-fav-capa-btn-ativo' : ''}`;
        btnFav.innerHTML = proc ? '★ Favoritado' : '☆ Favoritar';
        btnFav.addEventListener('click', async () => {
            const existente = await obterProcesso(numero);
            if (existente) {
                await removerProcesso(numero);
                btnFav.className = 'eproc-fav-capa-btn';
                btnFav.innerHTML = '☆ Favoritar';
                mostrarToast('Removido dos favoritos', 'info');
            } else {
                // FIX 3: Tentar extrair dados da página da capa
                const dadosCapa = extrairDadosDaCapa(numero);
                const novoProc = prepararProcesso(dadosCapa, null);
                await salvarProcesso(novoProc);
                btnFav.className = 'eproc-fav-capa-btn eproc-fav-capa-btn-ativo';
                btnFav.innerHTML = '★ Favoritado';
                mostrarToast('Adicionado aos favoritos!', 'sucesso');
            }
            atualizarBadgeTrigger();
        });

        // Botão Observações
        const btnObs = document.createElement('button');
        btnObs.className = 'eproc-fav-capa-btn';
        btnObs.innerHTML = '📝 Obs';
        btnObs.addEventListener('click', async () => {
            let existente = await obterProcesso(numero);
            if (!existente) {
                const dadosCapa = extrairDadosDaCapa(numero);
                await salvarProcesso(prepararProcesso(dadosCapa, null));
                btnFav.className = 'eproc-fav-capa-btn eproc-fav-capa-btn-ativo';
                btnFav.innerHTML = '★ Favoritado';
            }
            abrirModalObservacoes(numero);
        });

        // Botão Etiquetas
        const btnTags = document.createElement('button');
        btnTags.className = 'eproc-fav-capa-btn';
        btnTags.innerHTML = '🏷️ Tags';
        btnTags.addEventListener('click', async () => {
            let existente = await obterProcesso(numero);
            if (!existente) {
                const dadosCapa = extrairDadosDaCapa(numero);
                await salvarProcesso(prepararProcesso(dadosCapa, null));
                btnFav.className = 'eproc-fav-capa-btn eproc-fav-capa-btn-ativo';
                btnFav.innerHTML = '★ Favoritado';
            }
            abrirModalEtiquetas(numero);
        });

        container.append(btnFav, btnObs, btnTags);

        // Inserir no local certo
        if (numEl) {
            numEl.parentNode.insertBefore(container, numEl.nextSibling);
        } else {
            // Fallback: inserir no topo da página
            const barra = document.querySelector('#divInfraBarraSuperior, .infraBarraSuperior, header');
            if (barra) barra.appendChild(container);
        }

        // Se já é favorito, aproveitar que a capa está carregada para preencher o que
        // a API de consulta por nome nunca devolve (último evento, assuntos) e para
        // completar favoritos que foram salvos só com o número.
        if (proc) {
            const atualizado = mesclarProcesso(proc, extrairDadosDaCapa(numero));
            atualizado.novo = false; // o usuário está vendo o processo agora
            await salvarProcesso(atualizado);
            await atualizarBadgeTrigger();
        }
    }

    // FIX 3: Extrair dados disponíveis da página de capa do processo
    function extrairDadosDaCapa(numero) {
        const dados = {
            nr_processo: numero,
            linkProcessoAssinado: location.href,
            autor: '',
            reu: '',
            classe: '',
            des_situacao: '',
            ultimo_evento: '',
            des_assuntos: '',
            str_sig_orgao_juizo: '',
            cod_classe: '',
            cod_competencia: ''
        };

        // Seletores como [id*="classe"] casam com QUALQUER id que contenha a substring,
        // inclusive divs de layout — e aí o textContent traria meia página para dentro
        // do campo. Descartamos textos longos demais para serem um rótulo.
        const textoCurto = (el) => {
            if (!el) return '';
            const t = (el.textContent || '').trim().replace(/\s+/g, ' ');
            return t.length > 0 && t.length <= 120 ? t : '';
        };

        dados.classe = textoCurto(document.querySelector('#txtClasse'))
                    || textoCurto(document.querySelector('[id*="classe" i]'));

        dados.str_sig_orgao_juizo = textoCurto(document.querySelector('#txtOrgaoJulgador'))
                                 || textoCurto(document.querySelector('[id*="orgao" i]'));

        // Tentar extrair partes da tabela de partes
        for (const tr of document.querySelectorAll('#tabelaPartes tr, .infraTable tr')) {
            const texto = (tr.textContent || '').trim();
            if (texto.length > 400) continue; // linha de layout, não de parte
            const nome = () => textoCurto(tr.querySelector('td:last-child, td:nth-child(2)'));
            if (!dados.autor && /autor|requerente|exequente/i.test(texto)) dados.autor = nome();
            if (!dados.reu && /r[eé]u|requerido|executado/i.test(texto)) dados.reu = nome();
        }

        dados.des_situacao = textoCurto(document.querySelector('#txtSituacao'))
                          || textoCurto(document.querySelector('[id*="situacao" i]'));

        dados.ultimo_evento = extrairUltimoEventoDaCapa();

        return dados;
    }

    // O último evento é a única informação que realmente indica movimentação do
    // processo, e ele NÃO vem na API de consulta por nome — só existe renderizado na
    // capa. Tampouco é possível buscar a capa por fetch: sem o `hash` assinado o eproc
    // encerra a sessão do usuário. Por isso capturamos o evento oportunisticamente,
    // quando o usuário abre a capa.
    //
    // TODO: seletores por heurística de cabeçalho — validar contra a capa real do eproc.
    function extrairUltimoEventoDaCapa() {
        for (const tabela of document.querySelectorAll('table')) {
            const cabecalhos = [...tabela.querySelectorAll('th')]
                .map(th => normalizarBusca(th.textContent));
            if (!cabecalhos.length) continue;

            const idxData = cabecalhos.findIndex(h => /data/.test(h));
            const idxDesc = cabecalhos.findIndex(h => /descri|evento|movimenta/.test(h));
            if (idxDesc === -1) continue;

            // A capa lista os eventos do mais recente para o mais antigo.
            const linha = [...tabela.rows].find(r => r.cells.length > idxDesc && !r.querySelector('th'));
            if (!linha) continue;

            const limpar = (i) => i >= 0 && linha.cells[i]
                ? (linha.cells[i].textContent || '').trim().replace(/\s+/g, ' ')
                : '';
            const desc = limpar(idxDesc);
            if (!desc) continue;

            const data = limpar(idxData);
            return data ? `${data} - ${desc}` : desc;
        }
        return '';
    }

    // ==============================
    // BACKUP
    // ==============================
    async function exportarBackup() {
        try {
            const processos = await listarFavoritos();
            const consultas = await listarConsultas();
            const etiquetas = await listarEtiquetas();

            const backup = {
                versao: '1.1',
                dataExportacao: new Date().toISOString(),
                processos,
                consultas,
                etiquetas
            };

            const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `eproc-favoritos-backup-${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
            URL.revokeObjectURL(url);

            mostrarToast(`Backup exportado: ${processos.length} processo(s), ${consultas.length} consulta(s)`, 'sucesso');
        } catch (e) {
            mostrarToast('Erro ao exportar backup', 'erro');
            console.error('[EPROC-FAV] Erro export:', e);
        }
    }

    function importarBackup() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            try {
                const texto = await file.text();
                const backup = JSON.parse(texto);

                if (!backup.processos || !Array.isArray(backup.processos)) {
                    mostrarToast('Arquivo de backup inválido', 'erro');
                    return;
                }

                const sim = await confirmar(
                    `Importar backup com ${backup.processos.length} processo(s), ` +
                    `${(backup.consultas || []).length} consulta(s) e ` +
                    `${(backup.etiquetas || []).length} etiqueta(s)?<br><br>` +
                    `Dados existentes serão mesclados (não substituídos).`
                );
                if (!sim) return;

                let importados = 0;

                if (backup.etiquetas) {
                    for (const et of backup.etiquetas) await salvarEtiqueta(et);
                }

                for (const proc of backup.processos) {
                    const existente = await obterProcesso(proc.numero);
                    if (existente) {
                        if (!existente.observacoes && proc.observacoes) existente.observacoes = proc.observacoes;
                        if (proc.tags) existente.tags = [...new Set([...(existente.tags || []), ...proc.tags])];
                        await salvarProcesso(existente);
                    } else {
                        await salvarProcesso(proc);
                        importados++;
                    }
                }

                if (backup.consultas) {
                    for (const c of backup.consultas) {
                        const copy = { ...c };
                        delete copy.id;
                        await salvarConsulta(copy);
                    }
                }

                mostrarToast(`Importado: ${importados} novo(s) processo(s)`, 'sucesso');
                if (_painelAberto) renderizarPainel();
                atualizarBadgeTrigger();
            } catch (e) {
                mostrarToast('Erro ao importar backup', 'erro');
                console.error('[EPROC-FAV] Erro import:', e);
            }
        });
        input.click();
    }

    // ==============================
    // INICIALIZAÇÃO
    // ==============================
    async function inicializar() {
        try {
            await abrirBanco();
        } catch (e) {
            console.error('[EPROC-FAV] Erro ao abrir banco:', e);
            return;
        }

        carregarPrefs();
        injetarEstilos();
        instalarInterceptor();
        criarPainelLateral();
        atualizarBadgeTrigger();

        // Polling para injetar elementos na página
        setInterval(async () => {
            // Tabela de processos
            const container = document.getElementById('divInfraAreaTabela');
            if (container) {
                const table = container.querySelector('table');
                if (table && !table.dataset.eprocFavProcessada) {
                    await injetarEstrelasTabela();
                }
            }

            // Capa do processo — só nas telas onde ela existe, para não rodar
            // 5 querySelector inúteis a cada 800ms em toda página do eproc.
            if (ehTelaCapa() && !document.getElementById('eproc-fav-capa-acoes')) {
                await injetarBotoesCapa();
            }
        }, 800);
    }

    // Boot
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', inicializar);
    } else {
        inicializar();
    }

})();
