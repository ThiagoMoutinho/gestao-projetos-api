# Agendador de notificações — operação

Este documento descreve **como executar e supervisionar** o agendador das notificações do acompanhamento semanal do
resumo executivo (Etapa 3.4). Ele **não** implanta infraestrutura: apresenta as opções e o roteiro. O agendador nasce
**desligado**, e as notificações continuam **desativadas** até que o ADMIN as ative formalmente (com corte, justificativa e
auditoria).

## 1. Como funciona (resumo)

- A cada cerca de **10 minutos** (configurável, mínimo 5) uma instância "reserva a vez" no banco, avalia os prazos e, se
  houver trabalho, executa o mesmo gerador da Etapa 3.3. Tick sem trabalho não deixa linha de execução.
- **Processamento técnico** (avaliação, conciliação de pendências, ocorrências, telemetria) pode ocorrer a qualquer hora.
  **Entrega** de notificações só em **dia útil** (calendário institucional validado), de **9h00 a 17h59** (Belém). Fora disso
  os avisos ficam **adiados** e saem no primeiro ciclo dentro da janela.
- Com `activation_enabled=false` o agendador apenas registra **telemetria** (batimentos e último ciclo). Nenhum aviso, entrega
  ou ocorrência operacional é criado — os gatilhos do banco recusam, mesmo que o código errasse.
- Várias instâncias podem rodar ao mesmo tempo (plugin da API + processo dedicado, ou réplicas): a **reserva** (token com
  validade e renovação), a **trava consultiva** do Postgres e as **chaves únicas** impedem execução e aviso duplicados.
- Falhas ficam no log, na tabela de execuções e no estado do agendador. Após 3 falhas seguidas (com as notificações
  ativadas) abre-se **uma** ocorrência `SCHEDULER_FAILURE`, resolvida após 2 ciclos bem-sucedidos seguidos.

## 2. Variáveis de ambiente

| Variável | Padrão | Significado |
|---|---|---|
| `NOTIFICATIONS_SCHEDULER_IN_API` | `off` | `on` liga o plugin dentro da API. Qualquer outro valor mantém desligado. |
| `NOTIFICATIONS_SCHEDULER_INTERVAL_MINUTES` | `10` | Intervalo entre verificações (mínimo 5). |
| `NOTIFICATIONS_SCHEDULER_LEASE_SECONDS` | `120` | Validade da reserva (mínimo 60). |
| `NOTIFICATIONS_SCHEDULER_RENEW_SECONDS` | `30` | Renovação da reserva durante o processamento (máx. metade da validade). |

Valores abaixo do mínimo são elevados ao mínimo e um aviso é escrito no log. A duração máxima de um ciclo é de 8 minutos.

## 3. Dois modos, o mesmo código

1. **Plugin na API** (`NOTIFICATIONS_SCHEDULER_IN_API=on`): simples; acompanha o ciclo de vida da API. Enquanto houver um
   **processo dedicado saudável**, o plugin **aguarda** (a segurança não depende dessa preferência).
2. **Processo dedicado** (recomendado em produção): `pnpm notifications:worker`.
   - `--once`: um ciclo forçado (diagnóstico manual) e termina.
   - `--dry-run [--cutoff=AAAA-MM-DD] [--as-of=...]`: só planeja e imprime; não reserva, não grava, não entrega.
   - `--healthcheck`: sai com 0 se o agendador está `FUNCIONANDO` ou `DESLIGADO`; 1 nos demais casos.
   - Encerra de forma limpa com SIGTERM/SIGINT (espera o ciclo em andamento).

Para usar só o processo dedicado, mantenha `NOTIFICATIONS_SCHEDULER_IN_API` desligada na API.

## 4. Opções de execução supervisionada (documentadas, não implantadas)

O agendador não deve depender de alguém manter um terminal aberto. Escolha conforme a infraestrutura institucional.

### 4.1 Docker (preferencial quando compatível)

Serviço próprio, com reinício automático e checagem de saúde. Exemplo (não faz parte do `docker-compose.yml` atual):

```yaml
  notifications-worker:
    build: .                      # imagem da API (Node + pnpm)
    command: ["pnpm", "notifications:worker"]
    restart: unless-stopped
    stop_grace_period: 40s        # tempo para o ciclo em andamento terminar
    environment:
      DATABASE_URL: ${DATABASE_URL}
      NOTIFICATIONS_SCHEDULER_INTERVAL_MINUTES: "10"
    healthcheck:
      test: ["CMD", "pnpm", "notifications:worker", "--healthcheck"]
      interval: 60s
      timeout: 20s
      retries: 3
```

### 4.2 pm2

`pm2 start "pnpm notifications:worker" --name notifications-worker --kill-timeout 40000` e `pm2 save` /
`pm2 startup` para subir com o servidor. O reinício automático já é o comportamento padrão do pm2.

### 4.3 Serviço do Windows (NSSM)

`nssm install GestaoProjetosAgendador pnpm notifications:worker`, com diretório de trabalho na pasta da API, recuperação
configurada para "reiniciar o serviço" e variáveis de ambiente no próprio serviço.

### 4.4 Contingência: Agendador de Tarefas

Tarefa agendada a cada 10 minutos executando `pnpm notifications:worker --once`. Mais simples, porém sem batimento
contínuo; o estado de saúde mostrará "sem sinal" entre execuções se o intervalo ultrapassar 5 minutos. Use apenas como
plano de contingência.

## 5. Estados de saúde (`GET /notifications/scheduler`, ADMIN e PMO)

O estado **técnico** (o agendador) é independente do **operacional** (as notificações estarem `ATIVADAS` ou `DESATIVADAS`).

| Estado técnico | Quando |
|---|---|
| `FUNCIONANDO` | Há instância com batimento recente (≤ 5 min) e o último ciclo bem-sucedido está dentro de 3 intervalos. |
| `EM_FALHA` | Instância viva, mas o último ciclo falhou, há falhas seguidas ou nenhum ciclo concluiu em 3 intervalos. |
| `SEM_SINAL` | Nenhuma instância viva (processo morto) ou desligamento limpo com as notificações ativadas. |
| `DESLIGADO` | Desligamento limpo registrado e notificações desativadas. |
| `DESCONHECIDO` | Sem dados suficientes (nunca houve instância) ou migration 0030 ainda não aplicada. |

A saúde é sempre calculada por **batimentos e resultados gravados**, nunca por uma configuração "habilitada".

## 6. Roteiro para entrar em operação (somente após autorização)

1. Backup do banco; aplicar a migration `0030_notification_scheduler.sql` (nunca antes do 0028 e do 0029).
2. Reiniciar a API (o plugin segue desligado). Conferir `GET /notifications/scheduler` → `DESCONHECIDO` (sem instância).
3. Subir **um** executor: processo dedicado (recomendado) **ou** `NOTIFICATIONS_SCHEDULER_IN_API=on`.
4. Conferir `FUNCIONANDO` com operação `DESATIVADAS` (somente telemetria).
5. Cadastrar as regras de destinatários e validar o calendário (ADMIN).
6. **Somente então** o ADMIN ativa as notificações (corte numa quinta-feira, justificativa, confirmação `ATIVAR`).

## 7. Diagnóstico e recuperação

- `pnpm notifications:worker --dry-run` mostra o que seria feito, sem gravar nada.
- Execução interrompida: a próxima execução real que obtiver a trava marca a linha `RUNNING` órfã como `FAILED`
  ("INTERROMPIDA") e segue — nada é apagado e nenhum aviso é duplicado.
- Registros técnicos de instâncias com mais de 30 dias são removidos pelo próprio agendador ao iniciar. Execuções, avisos,
  entregas e ocorrências nunca são removidos.
- Para pausar sem desligar o processo: o ADMIN desativa as notificações (o agendador passa a só registrar telemetria).

## 8. Limitações conhecidas

- O horário de Belém usa deslocamento fixo de −03:00 (sem horário de verão), como o restante do sistema.
- O agendador processa os projetos em sequência; para centenas de projetos o ciclo leva segundos, e consultas podem ser
  agrupadas no futuro.
- A proteção da tabela de auditoria e a padronização dos timestamps continuam como dívida técnica registrada.
