import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { formatDistanceToNow, parseISO, format } from 'date-fns';
import api from '../../api/client';
import { Task, CallOutcome, CallAttempt } from '../../types';

const OMS_BASE = 'https://oms.orangehealth.in/request';

const OUTCOMES: { value: CallOutcome; label: string; color: string; requiresCallback?: boolean }[] = [
  { value: 'CONNECTED_SCHEDULED', label: 'Connected — Scheduled', color: 'bg-green-50 text-green-700 border-green-300 hover:bg-green-100' },
  { value: 'CONNECTED_FOLLOW_UP', label: 'Connected — Need Follow-up', color: 'bg-blue-50 text-blue-700 border-blue-300 hover:bg-blue-100' },
  { value: 'CONNECTED_WILL_PAY', label: 'Connected — Will Pay', color: 'bg-teal-50 text-teal-700 border-teal-300 hover:bg-teal-100' },
  { value: 'NO_ANSWER', label: 'No Answer', color: 'bg-amber-50 text-amber-700 border-amber-300 hover:bg-amber-100' },
  { value: 'BUSY', label: 'Busy', color: 'bg-amber-50 text-amber-700 border-amber-300 hover:bg-amber-100' },
  { value: 'SWITCHED_OFF', label: 'Switched Off', color: 'bg-amber-50 text-amber-700 border-amber-300 hover:bg-amber-100' },
  { value: 'CALL_LATER', label: 'Call Later (Callback)', color: 'bg-purple-50 text-purple-700 border-purple-300 hover:bg-purple-100', requiresCallback: true },
  { value: 'NOT_INTERESTED', label: 'Not Interested', color: 'bg-red-50 text-red-700 border-red-300 hover:bg-red-100' },
  { value: 'WRONG_NUMBER', label: 'Wrong Number', color: 'bg-red-50 text-red-700 border-red-300 hover:bg-red-100' },
];

const OUTCOME_LABEL: Record<CallOutcome, string> = {
  CONNECTED_SCHEDULED: 'Scheduled',
  CONNECTED_FOLLOW_UP: 'Follow-up needed',
  CONNECTED_WILL_PAY: 'Will Pay',
  NO_ANSWER: 'No Answer',
  BUSY: 'Busy',
  SWITCHED_OFF: 'Switched Off',
  WRONG_NUMBER: 'Wrong Number',
  CALL_LATER: 'Callback requested',
  NOT_INTERESTED: 'Not Interested',
};

const OUTCOME_COLOR: Record<CallOutcome, string> = {
  CONNECTED_SCHEDULED: 'bg-green-100 text-green-700',
  CONNECTED_FOLLOW_UP: 'bg-blue-100 text-blue-700',
  CONNECTED_WILL_PAY: 'bg-teal-100 text-teal-700',
  NO_ANSWER: 'bg-amber-100 text-amber-700',
  BUSY: 'bg-amber-100 text-amber-700',
  SWITCHED_OFF: 'bg-amber-100 text-amber-700',
  WRONG_NUMBER: 'bg-red-100 text-red-700',
  CALL_LATER: 'bg-purple-100 text-purple-700',
  NOT_INTERESTED: 'bg-red-100 text-red-700',
};

export default function CallScreen() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [task, setTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const [selectedOutcome, setSelectedOutcome] = useState<CallOutcome | null>(null);
  const [notes, setNotes] = useState('');
  const [callbackTime, setCallbackTime] = useState('');
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    const fetchTask = async () => {
      try {
        const res = await api.get(`/tasks/${id}`);
        setTask(res.data);
        // Auto-lock when opened
        await api.post(`/tasks/${id}/start`).catch(() => {});
      } catch {
        setError('Failed to load task');
      } finally {
        setLoading(false);
      }
    };
    fetchTask();
  }, [id]);

  const handleSubmit = async () => {
    if (!selectedOutcome) return;
    if (selectedOutcome === 'CALL_LATER' && !callbackTime) {
      setError('Please select a callback time');
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      await api.post(`/tasks/${id}/outcome`, {
        outcome: selectedOutcome,
        notes: notes || undefined,
        callback_time: callbackTime || undefined,
      });
      navigate('/');
    } catch (err: unknown) {
      setError('Failed to submit outcome. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <svg className="animate-spin w-5 h-5 text-brand-600" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
        </svg>
      </div>
    );
  }

  if (!task) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-6">
        <div className="bg-red-50 text-red-700 border border-red-200 rounded-lg px-4 py-3 text-sm">{error || 'Task not found'}</div>
        <button onClick={() => navigate('/')} className="mt-4 text-sm text-brand-600 hover:underline">← Back to queue</button>
      </div>
    );
  }

  const latestNote = task.call_history?.find(c => c.notes)?.notes;

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      {/* Back */}
      <button
        onClick={() => navigate('/')}
        className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-base mb-4"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7"/>
        </svg>
        Back to queue
      </button>

      {/* Header card */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-xs mb-4 overflow-hidden">
        {/* Task type bar */}
        <div className="bg-brand-600 px-5 py-3 flex items-center justify-between">
          <div>
            <span className="text-white text-xs font-semibold uppercase tracking-wide">
              {task.type.replace(/_/g, ' ')}
            </span>
            <p className="text-brand-100 text-xs mt-0.5">Attempt {task.attempt_count + 1} of {task.max_attempts}</p>
          </div>
          {task.due_at && (
            <span className="text-brand-100 text-xs">
              Due {formatDistanceToNow(parseISO(task.due_at), { addSuffix: true })}
            </span>
          )}
        </div>

        {/* Patient info */}
        <div className="p-5">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-full bg-brand-50 border-2 border-brand-100 flex items-center justify-center flex-shrink-0">
              <span className="text-lg font-bold text-brand-600">{task.patient_name?.charAt(0)}</span>
            </div>
            <div className="flex-1">
              <h2 className="text-lg font-bold text-gray-900">{task.patient_name}</h2>
              {task.customer_name !== task.patient_name && (
                <p className="text-xs text-gray-500 mt-0.5">Booked by: {task.customer_name}</p>
              )}
              {(task.patient_age || task.patient_gender) && (
                <p className="text-sm text-gray-500">
                  {[task.patient_age && `${task.patient_age} yrs`, task.patient_gender].filter(Boolean).join(' · ')}
                </p>
              )}
            </div>

            {/* Call button */}
            <a
              href={`tel:${task.patient_phone}`}
              className="flex items-center gap-2 bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-base active:scale-95"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path d="M2 3a1 1 0 011-1h2.153a1 1 0 01.986.836l.74 4.435a1 1 0 01-.54 1.06l-1.548.773a11.037 11.037 0 006.105 6.105l.774-1.548a1 1 0 011.059-.54l4.435.74a1 1 0 01.836.986V17a1 1 0 01-1 1h-2C7.82 18 2 12.18 2 5V3z"/>
              </svg>
              {task.patient_phone}
            </a>
          </div>

          {/* Info grid */}
          <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-0.5">Doctor</p>
              <p className="text-gray-700 font-medium">{task.doctor_name}</p>
              <p className="text-gray-500 text-xs">{task.partner_name}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-0.5">Order</p>
              <a
                href={`${OMS_BASE}/${task.request_id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand-600 font-medium hover:underline flex items-center gap-1"
              >
                {task.request_id}
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/>
                </svg>
              </a>
              <p className="text-gray-400 text-xs">{task.oms_order_id}</p>
            </div>
            {task.order_value > 0 && (
              <div>
                <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-0.5">Order Value</p>
                <p className="text-gray-700 font-semibold">₹{task.order_value.toLocaleString()}</p>
              </div>
            )}
            {task.preferred_slot && (
              <div>
                <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-0.5">Preferred Slot</p>
                <p className="text-gray-700">{format(parseISO(task.preferred_slot), 'MMM d, h:mm a')}</p>
              </div>
            )}
          </div>

          {/* Tests */}
          {task.tests?.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Tests Ordered</p>
              <div className="flex flex-wrap gap-1.5">
                {task.tests.map(t => (
                  <span key={t} className="px-2.5 py-1 bg-gray-50 border border-gray-200 rounded-lg text-xs text-gray-700">{t}</span>
                ))}
                {task.packages?.map(p => (
                  <span key={p} className="px-2.5 py-1 bg-brand-50 border border-brand-200 rounded-lg text-xs text-brand-700">{p}</span>
                ))}
              </div>
            </div>
          )}

          {/* Prescription link */}
          {task.prescription_url && (
            <a
              href={task.prescription_url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex items-center gap-1.5 text-xs text-brand-600 hover:underline"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
              </svg>
              View Prescription
            </a>
          )}
        </div>
      </div>

      {/* Previous interaction insight */}
      {latestNote && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4 flex items-start gap-3">
          <svg className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd"/>
          </svg>
          <div>
            <p className="text-xs font-semibold text-amber-700 mb-0.5">Last Interaction</p>
            <p className="text-sm text-amber-800">"{latestNote}"</p>
          </div>
        </div>
      )}

      {/* OH Notes */}
      {task.oh_notes && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-4 flex items-start gap-3">
          <svg className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z"/>
          </svg>
          <div>
            <p className="text-xs font-semibold text-blue-700 mb-0.5">OH Note</p>
            <p className="text-sm text-blue-800">{task.oh_notes}</p>
          </div>
        </div>
      )}

      {/* Call history toggle */}
      {(task.call_history?.length ?? 0) > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 mb-4">
          <button
            onClick={() => setShowHistory(h => !h)}
            className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 rounded-xl transition-base"
          >
            <span className="flex items-center gap-2">
              <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
              </svg>
              Call History ({task.call_history?.length} attempt{task.call_history?.length !== 1 ? 's' : ''})
            </span>
            <svg className={`w-4 h-4 text-gray-400 transition-transform ${showHistory ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7"/>
            </svg>
          </button>

          {showHistory && (
            <div className="px-4 pb-4 space-y-3">
              {task.call_history?.map((attempt, i) => (
                <div key={attempt.id} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <div className="w-6 h-6 rounded-full bg-gray-100 border border-gray-200 flex items-center justify-center text-xs font-semibold text-gray-500">{task.call_history!.length - i}</div>
                    {i < (task.call_history?.length ?? 0) - 1 && <div className="w-px flex-1 bg-gray-100 my-1"/>}
                  </div>
                  <div className="flex-1 pb-2">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${OUTCOME_COLOR[attempt.outcome]}`}>
                        {OUTCOME_LABEL[attempt.outcome]}
                      </span>
                      <span className="text-xs text-gray-400">{attempt.agent_name}</span>
                      <span className="text-xs text-gray-400 ml-auto">
                        {format(parseISO(attempt.called_at), 'MMM d, h:mm a')}
                      </span>
                    </div>
                    {attempt.notes && (
                      <p className="text-xs text-gray-600 bg-gray-50 rounded-lg px-2.5 py-1.5 italic">"{attempt.notes}"</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Outcome selection */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="text-sm font-semibold text-gray-900 mb-3">Log Call Outcome</h3>

        <div className="grid grid-cols-1 gap-2 mb-4">
          {OUTCOMES.map(o => (
            <button
              key={o.value}
              onClick={() => { setSelectedOutcome(o.value); setError(''); }}
              className={`text-left px-3.5 py-2.5 rounded-lg border text-sm font-medium transition-base ${
                selectedOutcome === o.value
                  ? `${o.color} ring-2 ring-offset-1 ring-current`
                  : 'border-gray-200 text-gray-700 hover:bg-gray-50'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>

        {/* Callback time picker */}
        {selectedOutcome === 'CALL_LATER' && (
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Callback Time <span className="text-red-500">*</span>
            </label>
            <input
              type="datetime-local"
              value={callbackTime}
              onChange={e => setCallbackTime(e.target.value)}
              min={new Date().toISOString().slice(0, 16)}
              className="w-full px-3.5 py-2.5 text-sm border border-gray-300 rounded-lg text-gray-900 transition-base focus:border-brand-500 focus:ring-2 focus:ring-brand-100 outline-none"
            />
          </div>
        )}

        {/* Notes */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Notes <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder='e.g. "Patient travelling, call after 6 PM"'
            rows={2}
            className="w-full px-3.5 py-2.5 text-sm border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 resize-none transition-base focus:border-brand-500 focus:ring-2 focus:ring-brand-100 outline-none"
          />
        </div>

        {error && (
          <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 mb-4">
            <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd"/>
            </svg>
            {error}
          </div>
        )}

        <button
          onClick={handleSubmit}
          disabled={!selectedOutcome || submitting}
          className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-brand-600 text-white text-sm font-semibold rounded-lg transition-base hover:bg-brand-700 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting ? (
            <>
              <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
              Submitting...
            </>
          ) : 'Submit Outcome'}
        </button>
      </div>
    </div>
  );
}
