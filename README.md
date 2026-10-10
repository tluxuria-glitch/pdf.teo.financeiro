# Controle financeiro – Ponto dos Fogões Teófilo Otoni

Sistema web para analisar, lançar e atualizar vendas e contas a pagar **direto nas planilhas do Google**, sem mudar a estrutura delas.

## Como a segurança funciona
- Este repositório é **público e não guarda nenhum dado da empresa**: só o código. Nunca suba planilhas, `.xlsx`, extratos ou exportações aqui (o `.gitignore` já bloqueia `.xlsx` e `dados.*`).
- Os dados ficam nas planilhas do Google, que continuam privadas. O painel lê e grava por login Google, direto do seu navegador.
- Só entra quem a própria conta Google autorizar: no Google Cloud o app fica em modo **Teste** com apenas os e-mails que você listar.
- O acesso fica só na memória da aba: nada em cookie ou no armazenamento do navegador. Sai sozinho após 15 minutos parado.
- Gravação: só células de entrada que já existem (vendas: F, H, I, O, P, Q; contas: A a F). Nunca fórmulas, abas ou colunas. Toda gravação mostra "antes e depois", confere se a célula mudou enquanto você preenchia e lê de volta para validar.

## Ligar ao Google (uma vez só)
1. Em https://console.cloud.google.com crie um projeto (ex.: "painel-financeiro").
2. **APIs e serviços > Biblioteca**: ative a **Google Sheets API**.
3. **Tela de consentimento OAuth**: tipo **Externo**, nome do app, e-mail de contato. Em **Usuários de teste**, adicione somente os e-mails que vão usar (o seu e o da sua sócia, se for o caso). Deixe em modo **Teste**; não publique.
4. **Credenciais > Criar credenciais > ID do cliente OAuth > Aplicativo da Web**. Em **Origens JavaScript autorizadas** coloque `https://tluxuria-glitch.github.io`. Não precisa de URI de redirecionamento.
5. Copie o **ID do cliente** e cole em `docs/config.js` no campo `CLIENT_ID`.
6. No GitHub: **Settings > Pages > Branch `main`, pasta `/docs`**. O painel abre em `https://tluxuria-glitch.github.io/pdf.teo.financeiro/`.

Observação: no modo Teste, o Google pede nova autorização a cada 7 dias. É o preço de manter o app restrito.

## Uso diário
- **Hoje**: o que está atrasado, o que vence em 7 dias, venda do dia e andamento do mês.
- **Vendas**: lançar ou corrigir um dia (fechamento do caixa, cartão, PIX, outros, saídas).
- **Contas**: filtros por situação, dar baixa, editar e criar conta na próxima linha vazia.
- **Análise**: faturamento, formas de pagamento e contas por mês.
- **Alertas**: erros e inconsistências nas planilhas.

Cores fixas: verde = pago, amarelo = vence em até 7 dias, vermelho = atrasada, roxo = mês encerrado para conferir, azul = futuro ou ação.

## Script opcional
`scripts/gerar_dados.py` gera totais a partir de planilhas baixadas em `.xlsx` (uso local; a saída não é versionada).
