import { useEffect, useState, useCallback } from 'react';
import { formatDistanceToNow, parseISO, format } from 'date-fns';
import api from '../../api/client';
import { Task, TaskType, LeadState, CallOutcome, CallAttempt } from '../../types';

const OMS_BASE = 'https://oms.orangehealth.in/request';

const TASK_TYPE_LABEL: Record<TaskType, string> = {
  FIRST_CALL: 'First Call',
  RETRY_CALL: 'Retry',
  CALLBACK: 'Callback',
  FUTURE_CALL: 'Follow-up',
};

const TASK_TYPE_COLOR: Record<TaskType, string> = {
  FIRST_CALL: 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-800',
  RETRY_CALL: 'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800',
  CALLBACK: 'bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 border-purple-200 dark:border-purple-800',
  FUTURE_CALL: 'bg-teal-50 dark:bg-teal-900/30 text-teal-700 dark:text-teal-400 border-teal-200 dark:border-teal-800',
};

const OUTCOME_COLOR: Record<CallOutcome, string> = {
  CONNECTED_SCHEDULED: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400',
  CONNECTED_FOLLOW_UP: 'bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-400',
  CONNECTED_WILL_PAY: 'bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-400',
  NO_ANSWER: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400',
  BUSY: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400',
  SWITCHED_OFF: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400',
  WRONG_NUMBER: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400',
  CALL_LATER: 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400',
  NOT_INTERESTED: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400',
};

const OUTCOME_LABEL: Record<CallOutcome, string> = {
  CONNECTED_SCHEDULED: 'Scheduled',
  CONNECTED_FOLLOW_UP: 'Follow-up',
  CONNECTED_WILL_PAY: 'Will Pay',
  NO_ANSWER: 'No Answer',
  BUSY: 'Busy',
  SWITCHED_OFF: 'Switched Off',
  WRONG_NUMBER: 'Wrong Number',
  CALL_LATER: 'Call Later',
  NOT_INTERESTED: 'Not Interested',
};

const CANCELLATION_REASONS = [
  'Need to add/remove tests',
  'Need to change address',
  'Need to change slot/time',
  'Patient unavailable',
  'Cost issue / too expensive',
  'Doctor prescription changed',
  'Duplicate request',
  'Patient recovered / no longer needs tests',
  'Patient already booked elsewhere',
  'Other',
];

type OutcomeSection = {
  label: string;
  color: string;
  ring: string;
  outcomes: { value: CallOutcome; label: string; icon: string }[];
};

const OUTCOME_SECTIONS: OutcomeSection[] = [
  {
    label: 'Connected',
    color: 'text-emerald-700 dark:text-emerald-400',
    ring: 'ring-emerald-400 dark:ring-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 border-emerald-300 dark:border-emerald-700',
    outcomes: [
      { value: 'CONNECTED_SCHEDULED', label: 'Appointment Scheduled', icon: '✅' },
      { value: 'CONNECTED_FOLLOW_UP', label: 'Follow-up Needed', icon: '🔄' },
      { value: 'CONNECTED_WILL_PAY', label: 'Will Pay Later', icon: '💳' },
    ],
  },
  {
    label: 'Unreachable',
    color: 'text-amber-700 dark:text-amber-400',
    ring: 'ring-amber-400 dark:ring-amber-600 bg-amber-50 dark:bg-amber-900/20 border-amber-300 dark:border-amber-700',
    outcomes: [
      { value: 'NO_ANSWER', label: 'No Answer', icon: '📵' },
      { value: 'BUSY', label: 'Busy / Engaged', icon: '🚫' },
      { value: 'SWITCHED_OFF', label: 'Switched Off', icon: '⚡' },
    ],
  },
  {
    label: 'Callback',
    color: 'text-purple-700 dark:text-purple-400',
    ring: 'ring-purple-400 dark:ring-purple-600 bg-purple-50 dark:bg-purple-900/20 border-purple-300 dark:border-purple-700',
    outcomes: [
      { value: 'CALL_LATER', label: 'Schedule Callback', icon: '📅' },
    ],
  },
  {
    label: 'Close Lead',
    color: 'text-red-700 dark:text-red-400',
    ring: 'ring-red-400 dark:ring-red-600 bg-red-50 dark:bg-red-900/20 border-red-300 dark:border-red-700',
    outcomes: [
      { value: 'NOT_INTERESTED', label: 'Not Interested / Cancel', icon: '🚫' },
      { value: 'WRONG_NUMBER', label: 'Wrong Number', icon: '❌' },
    ],
  },
];

const NEEDS_CALLBACK: CallOutcome[] = ['CALL_LATER'];
const NEEDS_FOLLOWUP_TIME: CallOutcome[] = ['CONNECTED_FOLLOW_UP'];
const NEEDS_CANCELLATION: CallOutcome[] = ['NOT_INTERESTED', 'WRONG_NUMBER'];

export default function AgentQueue() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loadingQueue, setLoadingQueue] = useState(true);
  const [queueError, setQueueError] = useState('');

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [taskDetail, setTaskDetail] = useState<Task | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');

  const [selectedOutcome, setSelectedOutcome] = useState<CallOutcome | null>(null);
  const [notes, setNotes] = useState('');
  const [callbackTime, setCallbackTime] = useState('');
  const [cancellationReason, setCancellationReason] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const fetchQueue = useCallback(async (silent = false) => {
    if (!silent) setLoadingQueue(true);
    try {
      const res = await api.get('/tasks/my-queue');
      setTasks(res.data);
      setQueueError('');
    } catch {
      setQueueError('Failed to load queue');
    } finally {
      setLoadingQueue(false);
    }
  }, []);

  useEffect(() => {
    fetchQueue();
    const interval = setInterval(() => fetchQueue(true), 10000);
    return () => clearInterval(interval);
  }, [fetchQueue]);

  useEffect(() => {
    if (!selectedId) { setTaskDetail(null); return; }
    const load = async () => {
      setDetailLoading(true);
      setDetailError('');
      setSelectedOutcome(null);
      setNotes('');
      setCallbackTime('');
      setCancellationReason('');
      setShowHistory(false);
      setSubmitError('');
      try {
        const res = await api.get(`/tasks/${selectedId}`);
        setTaskDetail(res.data);
        await api.post(`/tasks/${selectedId}/start`).catch(() => {});
      } catch {
        setDetailError('Failed to load task');
      } finally {
        setDetailLoading(false);
      }
    };
    load();
  }, [selectedId]);

  const handleOutcomeChange = (outcome: CallOutcome) => {
    setSelectedOutcome(outcome);
    setCallbackTime('');
    setCancellationReason('');
    setSubmitError('');
  };

  const handleSubmit = async () => {
    if (!selectedOutcome || !selectedId) return;
    if (NEEDS_CALLBACK.includes(selectedOutcome) && !callbackTime) {
      setSubmitError('Please select a callback date and time');
      return;
    }
    if (NEEDS_CANCELLATION.includes(selectedOutcome) && !cancellationReason) {
      setSubmitError('Please select a cancellation reason');
      return;
    }
    setSubmitting(true);
    setSubmitError('');
    try {
      await api.post(`/tasks/${selectedId}/outcome`, {
        outcome: selectedOutcome,
        notes: notes || undefined,
        callback_time: callbackTime || undefined,
        cancellation_reason: cancellationReason || undefined,
      });
      setSelectedId(null);
      setTaskDetail(null);
      await fetchQueue(true);
    } catch {
      setSubmitError('Failed to submit. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const isOverdue = (task: Task) => task.due_at && new Date(task.due_at) < new Date();

  return (
    <div className="h-full flex bg-gray-50 dark:bg-gray-950">
      {/* Left: Queue Panel */}
      <div className="w-80 flex-shrink-0 flex flex-col border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
        <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between flex-shrink-0">
          <div>
            <h1 className="text-sm font-bold text-gray-900 dark:text-white">My Queue</h1>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{tasks.length} task{tasks.length !== 1 ? 's' : ''}</p>
          </div>
          <button
            onClick={() => fetchQueue()}
            className="p-1.5 rounded-lg text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-base"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
          {loadingQueue ? (
            <div className="flex justify-center py-10">
              <svg className="animate-spin w-5 h-5 text-brand-600" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
            </div>
          ) : queueError ? (
            <p className="text-xs text-red-500 dark:text-red-400 px-2 py-2">{queueError}</p>
          ) : tasks.length === 0 ? (
            <div className="text-center py-12">
              <div className="w-12 h-12 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center mx-auto mb-3">
                <svg className="w-6 h-6 text-gray-300 dark:text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/>
                </svg>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 font-medium">Queue is empty</p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Tasks appear here automatically</p>
            </div>
          ) : (
            tasks.map((task, index) => (
              <button
                key={task.id}
                onClick={() => setSelectedId(task.id)}
                className={`w-full text-left rounded-xl border transition-all p-3 ${
                  selectedId === task.id
                    ? 'border-brand-400 dark:border-brand-600 bg-brand-50 dark:bg-brand-900/20 ring-1 ring-brand-300 dark:ring-brand-700'
                    : isOverdue(task)
                    ? 'border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-900/10 hover:border-red-300 dark:hover:border-red-700'
                    : 'border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 hover:border-brand-200 dark:hover:border-gray-700 hover:shadow-sm'
                }`}
              >
                <div className="flex items-center gap-1.5 mb-2 flex-wrap">
                  <span className="text-xs font-mono text-gray-300 dark:text-gray-600">{index + 1}.</span>
                  <span className={`inline-flex items-center px-1.5 py-0.5 rounded-md text-xs font-semibold border ${TASK_TYPE_COLOR[task.type]}`}>
                    {TASK_TYPE_LABEL[task.type]}
                  </span>
                  {isOverdue(task) && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-xs font-semibold bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800">
                      <span className="w-1 h-1 bg-red-500 rounded-full animate-pulse"/>
                      Overdue
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-full bg-brand-50 dark:bg-brand-900/30 flex items-center justify-center flex-shrink-0">
                    <span className="text-xs font-semibold text-brand-600 dark:text-brand-400">{task.patient_name?.charAt(0)}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">{task.patient_name}</p>
                    <p className="text-xs text-gray-400 dark:text-gray-500 truncate">{task.patient_phone}</p>
                  </div>
                </div>
                {(task.tests?.length > 0 || task.packages?.length > 0) && (
                  <p className="mt-1.5 text-xs text-gray-400 dark:text-gray-500 truncate">
                    {[...(task.tests || []), ...(task.packages || [])].join(', ')}
                  </p>
                )}
                {task.due_at && (
                  <p className={`mt-1 text-xs ${isOverdue(task) ? 'text-red-500 dark:text-red-400 font-medium' : 'text-gray-400 dark:text-gray-500'}`}>
                    {isOverdue(task) ? '⚠ ' : ''}
                    {formatDistanceToNow(parseISO(task.due_at), { addSuffix: true })}
                  </p>
                )}
              </button>
            ))
          )}
        </div>
      </div>

      {/* Right: Detail Panel */}
      <div className="flex-1 overflow-y-auto">
        {!selectedId ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-center">
              <div className="w-16 h-16 bg-gray-100 dark:bg-gray-800 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-gray-300 dark:text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/>
                </svg>
              </div>
              <p className="text-gray-500 dark:text-gray-400 font-medium text-sm">Select a task to begin</p>
              <p className="text-gray-400 dark:text-gray-500 text-xs mt-1">Pick a task from the queue on the left</p>
            </div>
          </div>
        ) : detailLoading ? (
          <div className="h-full flex items-center justify-center">
            <svg className="animate-spin w-6 h-6 text-brand-600" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
            </svg>
          </div>
        ) : detailError ? (
          <div className="max-w-2xl mx-auto px-5 py-5">
            <div className="bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800 rounded-lg px-4 py-3 text-sm">{detailError}</div>
            <button onClick={() => setSelectedId(null)} className="mt-3 text-sm text-brand-600 hover:underline">← Back</button>
          </div>
        ) : taskDetail ? (
          <CallDetail
            task={taskDetail}
            selectedOutcome={selectedOutcome}
            onOutcomeChange={handleOutcomeChange}
            notes={notes}
            setNotes={setNotes}
            callbackTime={callbackTime}
            setCallbackTime={setCallbackTime}
            cancellationReason={cancellationReason}
            setCancellationReason={setCancellationReason}
            showHistory={showHistory}
            setShowHistory={setShowHistory}
            submitting={submitting}
            submitError={submitError}
            onSubmit={handleSubmit}
            onBack={() => setSelectedId(null)}
          />
        ) : null}
      </div>
    </div>
  );
}

function CallDetail({
  task, selectedOutcome, onOutcomeChange,
  notes, setNotes, callbackTime, setCallbackTime,
  cancellationReason, setCancellationReason,
  showHistory, setShowHistory, submitting, submitError, onSubmit, onBack,
}: {
  task: Task;
  selectedOutcome: CallOutcome | null;
  onOutcomeChange: (o: CallOutcome) => void;
  notes: string; setNotes: (n: string) => void;
  callbackTime: string; setCallbackTime: (t: string) => void;
  cancellationReason: string; setCancellationReason: (r: string) => void;
  showHistory: boolean; setShowHistory: (s: boolean) => void;
  submitting: boolean; submitError: string;
  onSubmit: () => void; onBack: () => void;
}) {
  const latestNote = task.call_history?.find((c: CallAttempt) => c.notes)?.notes;
  const needsCallback = selectedOutcome && NEEDS_CALLBACK.includes(selectedOutcome);
  const needsFollowupTime = selectedOutcome && NEEDS_FOLLOWUP_TIME.includes(selectedOutcome);
  const needsCancellation = selectedOutcome && NEEDS_CANCELLATION.includes(selectedOutcome);

  return (
    <div className="max-w-2xl mx-auto px-5 py-5">
      {/* Header */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 shadow-xs mb-4 overflow-hidden">
        <div className="bg-brand-600 px-5 py-3 flex items-center justify-between">
          <div>
            <span className="text-white text-xs font-semibold uppercase tracking-wide">{task.type.replace(/_/g, ' ')}</span>
            <p className="text-brand-200 text-xs mt-0.5">Attempt {task.attempt_count + 1} of {task.max_attempts}</p>
          </div>
          <div className="flex items-center gap-3">
            {task.due_at && (
              <span className="text-brand-100 text-xs">Due {formatDistanceToNow(parseISO(task.due_at), { addSuffix: true })}</span>
            )}
            <button onClick={onBack} className="text-brand-200 hover:text-white text-xs flex items-center gap-1 transition-colors">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
              </svg>
              Close
            </button>
          </div>
        </div>

        <div className="p-5">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-full bg-brand-50 dark:bg-brand-900/30 border-2 border-brand-100 dark:border-brand-800 flex items-center justify-center flex-shrink-0">
              <span className="text-lg font-bold text-brand-600 dark:text-brand-400">{task.patient_name?.charAt(0)}</span>
            </div>
            <div className="flex-1">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">{task.patient_name}</h2>
              {task.customer_name !== task.patient_name && (
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Booked by: {task.customer_name}</p>
              )}
              {(task.patient_age || task.patient_gender) && (
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {[task.patient_age && `${task.patient_age} yrs`, task.patient_gender].filter(Boolean).join(' · ')}
                </p>
              )}
            </div>
            <a
              href={`tel:${task.patient_phone}`}
              className="flex items-center gap-2 bg-green-500 hover:bg-green-600 active:bg-green-700 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-base active:scale-95 shadow-sm"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path d="M2 3a1 1 0 011-1h2.153a1 1 0 01.986.836l.74 4.435a1 1 0 01-.54 1.06l-1.548.773a11.037 11.037 0 006.105 6.105l.774-1.548a1 1 0 011.059-.54l4.435.74a1 1 0 01.836.986V17a1 1 0 01-1 1h-2C7.82 18 2 12.18 2 5V3z"/>
              </svg>
              {task.patient_phone}
            </a>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-0.5">Doctor</p>
              <p className="text-gray-700 dark:text-gray-300 font-medium">{task.doctor_name}</p>
              <p className="text-gray-400 dark:text-gray-500 text-xs">{task.partner_name}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-0.5">Request</p>
              <a href={`${OMS_BASE}/${task.request_id}`} target="_blank" rel="noopener noreferrer"
                className="text-brand-600 dark:text-brand-400 font-medium hover:underline flex items-center gap-1">
                {task.request_id}
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/>
                </svg>
              </a>
              <p className="text-gray-400 dark:text-gray-500 text-xs">{task.oms_order_id}</p>
            </div>
            {task.order_value > 0 && (
              <div>
                <p className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-0.5">Order Value</p>
                <p className="text-gray-700 dark:text-gray-300 font-semibold">&#8377;{task.order_value.toLocaleString()}</p>
              </div>
            )}
            {task.preferred_slot && (
              <div>
                <p className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-0.5">Preferred Slot</p>
                <p className="text-gray-700 dark:text-gray-300">{format(parseISO(task.preferred_slot), 'MMM d, h:mm a')}</p>
              </div>
            )}
          </div>

          {task.tests?.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-2">Tests Ordered</p>
              <div className="flex flex-wrap gap-1.5">
                {task.tests.map((t: string) => (
                  <span key={t} className="px-2.5 py-1 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-xs text-gray-700 dark:text-gray-300">{t}</span>
                ))}
                {task.packages?.map((p: string) => (
                  <span key={p} className="px-2.5 py-1 bg-brand-50 dark:bg-brand-900/30 border border-brand-200 dark:border-brand-800 rounded-lg text-xs text-brand-700 dark:text-brand-400">{p}</span>
                ))}
              </div>
            </div>
          )}
          {task.prescription_url && (
            <a href={task.prescription_url} target="_blank" rel="noopener noreferrer"
              className="mt-3 inline-flex items-center gap-1.5 text-xs text-brand-600 dark:text-brand-400 hover:underline">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
              </svg>
              View Prescription
            </a>
          )}
        </div>
      </div>

      {latestNote && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-3.5 mb-4 flex items-start gap-3">
          <svg className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd"/>
          </svg>
          <div>
            <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 mb-0.5">Last Interaction</p>
            <p className="text-sm text-amber-800 dark:text-amber-300">"{latestNote}"</p>
          </div>
        </div>
      )}

      {task.oh_notes && (
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-3.5 mb-4 flex items-start gap-3">
          <svg className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z"/>
          </svg>
          <div>
            <p className="text-xs font-semibold text-blue-700 dark:text-blue-400 mb-0.5">OH Note</p>
            <p className="text-sm text-blue-800 dark:text-blue-300">{task.oh_notes}</p>
          </div>
        </div>
      )}

      {(task.call_history?.length ?? 0) > 0 && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 mb-4">
          <button
            onClick={() => setShowHistory(!showHistory)}
            className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-xl transition-base"
          >
            <span className="flex items-center gap-2">
              <svg className="w-4 h-4 text-gray-400 dark:text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
              </svg>
              Call History ({task.call_history?.length} attempt{task.call_history?.length !== 1 ? 's' : ''})
            </span>
            <svg className={`w-4 h-4 text-gray-400 dark:text-gray-500 transition-transform ${showHistory ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7"/>
            </svg>
          </button>
          {showHistory && (
            <div className="px-4 pb-4 space-y-3">
              {task.call_history?.map((attempt: CallAttempt, i: number) => (
                <div key={attempt.id} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <div className="w-6 h-6 rounded-full bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 flex items-center justify-center text-xs font-semibold text-gray-500 dark:text-gray-400">
                      {task.call_history!.length - i}
                    </div>
                    {i < (task.call_history?.length ?? 0) - 1 && <div className="w-px flex-1 bg-gray-100 dark:bg-gray-800 my-1"/>}
                  </div>
                  <div className="flex-1 pb-2">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${OUTCOME_COLOR[attempt.outcome]}`}>
                        {OUTCOME_LABEL[attempt.outcome]}
                      </span>
                      <span className="text-xs text-gray-400 dark:text-gray-500">{attempt.agent_name}</span>
                      <span className="text-xs text-gray-400 dark:text-gray-500 ml-auto">
                        {format(parseISO(attempt.called_at), 'MMM d, h:mm a')}
                      </span>
                    </div>
                    {attempt.notes && (
                      <p className="text-xs text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-800 rounded-lg px-2.5 py-1.5 italic">"{attempt.notes}"</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Log Outcome Form ─────────────────────────────────────────────────── */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-1">Log Call Outcome</h3>
        <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">Select what happened on this call</p>

        <div className="space-y-4">
          {OUTCOME_SECTIONS.map(section => (
            <div key={section.label}>
              <p className={`text-xs font-semibold uppercase tracking-wide mb-2 ${section.color}`}>{section.label}</p>
              <div className="space-y-1.5">
                {section.outcomes.map(opt => {
                  const isSelected = selectedOutcome === opt.value;
                  return (
                    <label
                      key={opt.value}
                      className={`flex items-center gap-3 px-3.5 py-2.5 rounded-lg border cursor-pointer transition-all ${
                        isSelected
                          ? `ring-1 ${section.ring}`
                          : 'border-gray-100 dark:border-gray-800 hover:border-gray-200 dark:hover:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/50'
                      }`}
                    >
                      <input
                        type="radio"
                        name="outcome"
                        value={opt.value}
                        checked={isSelected}
                        onChange={() => onOutcomeChange(opt.value)}
                        className="sr-only"
                      />
                      <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all ${
                        isSelected ? 'border-brand-600 dark:border-brand-400' : 'border-gray-300 dark:border-gray-600'
                      }`}>
                        {isSelected && <div className="w-2 h-2 rounded-full bg-brand-600 dark:bg-brand-400"/>}
                      </div>
                      <span className="text-lg leading-none flex-shrink-0">{opt.icon}</span>
                      <span className={`text-sm font-medium ${isSelected ? 'text-gray-900 dark:text-white' : 'text-gray-600 dark:text-gray-400'}`}>
                        {opt.label}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* ── Contextual fields ─────────────────────────────────────────────── */}
        {(needsCallback || needsFollowupTime) && (
          <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-800">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              {needsCallback ? 'Schedule Callback' : 'Follow-up Reminder'}
              <span className="text-red-500 ml-1">*</span>
            </label>
            <input
              type="datetime-local"
              value={callbackTime}
              onChange={e => setCallbackTime(e.target.value)}
              min={new Date().toISOString().slice(0, 16)}
              className="w-full px-3.5 py-2.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white dark:bg-gray-800 transition-base focus:border-brand-500 focus:ring-2 focus:ring-brand-100 dark:focus:ring-brand-900 outline-none"
            />
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
              {needsCallback ? 'Patient will be called back at this time' : 'A follow-up reminder will be created'}
            </p>
          </div>
        )}

        {needsCancellation && (
          <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-800 space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                Cancellation Reason <span className="text-red-500">*</span>
              </label>
              <select
                value={cancellationReason}
                onChange={e => setCancellationReason(e.target.value)}
                className="w-full px-3.5 py-2.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white dark:bg-gray-800 transition-base focus:border-brand-500 focus:ring-2 focus:ring-brand-100 dark:focus:ring-brand-900 outline-none"
              >
                <option value="">Select a reason…</option>
                {CANCELLATION_REASONS.map(r => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
          </div>
        )}

        {/* ── Notes ───────────────────────────────────────────────────────── */}
        <div className="mt-4">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
            Notes <span className="text-xs text-gray-400 dark:text-gray-500 font-normal">(optional)</span>
          </label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder={needsCancellation ? 'Additional details about the cancellation…' : 'e.g. "Patient travelling, call after 6 PM"'}
            rows={2}
            className="w-full px-3.5 py-2.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white dark:bg-gray-800 placeholder-gray-400 dark:placeholder-gray-500 resize-none transition-base focus:border-brand-500 focus:ring-2 focus:ring-brand-100 dark:focus:ring-brand-900 outline-none"
          />
        </div>

        {submitError && (
          <div className="mt-3 flex items-center gap-2 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2.5">
            <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd"/>
            </svg>
            {submitError}
          </div>
        )}

        <button
          onClick={onSubmit}
          disabled={!selectedOutcome || submitting}
          className="mt-4 w-full flex items-center justify-center gap-2 py-3 px-4 bg-brand-600 text-white text-sm font-semibold rounded-lg transition-base hover:bg-brand-700 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
        >
          {submitting ? (
            <>
              <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
              Submitting…
            </>
          ) : selectedOutcome ? `Submit: ${OUTCOME_LABEL[selectedOutcome]}` : 'Submit Outcome'}
        </button>
      </div>
    </div>
  );
}
