import { useEffect, useState } from 'react';
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor,
  useSensor, useSensors, DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove, SortableContext, sortableKeyboardCoordinates,
  useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import api from '../../api/client';
import { PriorityBucket } from '../../types';

function SortableRow({ bucket, onEdit, onDelete, onToggle }: {
  bucket: PriorityBucket;
  onEdit: (b: PriorityBucket) => void;
  onDelete: (id: number) => void;
  onToggle: (b: PriorityBucket) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: bucket.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  const isActive = bucket.is_active === 1 || bucket.is_active === true;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`bg-white dark:bg-gray-900 border rounded-xl p-4 flex items-center gap-4 shadow-xs transition-all ${
        isDragging ? 'shadow-lg border-brand-300 dark:border-brand-700' : 'border-gray-200 dark:border-gray-700'
      } ${!isActive ? 'opacity-50' : ''}`}
    >
      <div
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing text-gray-300 dark:text-gray-600 hover:text-gray-500 dark:hover:text-gray-400 flex-shrink-0"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 8h16M4 16h16"/>
        </svg>
      </div>

      <div className="w-6 h-6 rounded-full bg-brand-50 dark:bg-brand-900/30 flex items-center justify-center flex-shrink-0">
        <span className="text-xs font-bold text-brand-600 dark:text-brand-400">{bucket.display_order}</span>
      </div>

      <div className="flex-1 min-w-0">
        <p className="font-medium text-gray-900 dark:text-white text-sm">{bucket.name}</p>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 font-mono truncate">
          {JSON.stringify(bucket.conditions)}
        </p>
      </div>

      <button
        onClick={() => onToggle(bucket)}
        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors flex-shrink-0 ${
          isActive ? 'bg-brand-600' : 'bg-gray-200 dark:bg-gray-700'
        }`}
      >
        <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transform transition-transform ${
          isActive ? 'translate-x-4' : 'translate-x-0.5'
        }`}/>
      </button>

      <button
        onClick={() => onEdit(bucket)}
        className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-base p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
        title="Edit"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
        </svg>
      </button>
      <button
        onClick={() => onDelete(bucket.id)}
        className="text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 transition-base p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20"
        title="Delete"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
        </svg>
      </button>
    </div>
  );
}

const CONDITION_TEMPLATES = [
  { label: 'Callbacks Due Now', conditions: { task_type: ['CALLBACK'], due_before: 'now' } },
  { label: 'Callbacks Due in 2h', conditions: { task_type: ['CALLBACK'], due_before: 'now+2h' } },
  { label: 'New Requests >4h Old', conditions: { task_type: ['FIRST_CALL'], created_before: 'now-4h' } },
  { label: 'All First Calls', conditions: { task_type: ['FIRST_CALL'] } },
  { label: 'All Retry Calls', conditions: { task_type: ['RETRY_CALL'] } },
  { label: 'Stale In-Progress >24h', conditions: { lead_state: ['ATTEMPTING'], created_before: 'now-24h' } },
  { label: 'Custom (edit JSON)', conditions: {} },
];

export default function QueueConfig() {
  const [buckets, setBuckets] = useState<PriorityBucket[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const [showModal, setShowModal] = useState(false);
  const [editBucket, setEditBucket] = useState<PriorityBucket | null>(null);
  const [formName, setFormName] = useState('');
  const [formConditions, setFormConditions] = useState('{}');
  const [formError, setFormError] = useState('');

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const fetchBuckets = async () => {
    try {
      const res = await api.get('/buckets');
      setBuckets(res.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchBuckets(); }, []);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setBuckets(items => {
      const oldIndex = items.findIndex(i => i.id === active.id);
      const newIndex = items.findIndex(i => i.id === over.id);
      const reordered = arrayMove(items, oldIndex, newIndex);
      return reordered.map((b, idx) => ({ ...b, display_order: idx + 1 }));
    });
    setDirty(true);
  };

  const saveOrder = async () => {
    setSaving(true);
    try {
      await api.put('/buckets/reorder/apply', {
        order: buckets.map(b => ({ id: b.id, display_order: b.display_order })),
      });
      setDirty(false);
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  const openCreate = () => {
    setEditBucket(null);
    setFormName('');
    setFormConditions('{}');
    setFormError('');
    setShowModal(true);
  };

  const openEdit = (b: PriorityBucket) => {
    setEditBucket(b);
    setFormName(b.name);
    setFormConditions(JSON.stringify(b.conditions, null, 2));
    setFormError('');
    setShowModal(true);
  };

  const handleSaveBucket = async () => {
    let parsed;
    try { parsed = JSON.parse(formConditions); } catch {
      setFormError('Invalid JSON in conditions');
      return;
    }
    setSaving(true);
    try {
      if (editBucket) {
        await api.put(`/buckets/${editBucket.id}`, { name: formName, conditions: parsed });
      } else {
        await api.post('/buckets', { name: formName, conditions: parsed });
      }
      await fetchBuckets();
      setShowModal(false);
    } catch (e) {
      setFormError('Failed to save bucket');
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (bucket: PriorityBucket) => {
    try {
      await api.put(`/buckets/${bucket.id}`, { is_active: !(bucket.is_active === 1 || bucket.is_active === true) });
      await fetchBuckets();
    } catch (e) {
      console.error(e);
    }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm('Delete this priority bucket?')) return;
    try {
      await api.delete(`/buckets/${id}`);
      await fetchBuckets();
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Queue Configuration</h1>
          <p className="text-sm text-gray-400 dark:text-gray-500 mt-0.5">Drag to reorder priority buckets. Agents see tasks in this order.</p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-1.5 px-4 py-2 bg-brand-600 text-white text-sm font-semibold rounded-lg hover:bg-brand-700 transition-base active:scale-95"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4"/>
          </svg>
          Add Bucket
        </button>
      </div>

      {dirty && (
        <div className="mb-4 flex items-center justify-between bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl px-4 py-3">
          <p className="text-sm text-amber-700 dark:text-amber-400 font-medium">You have unsaved order changes</p>
          <button
            onClick={saveOrder}
            disabled={saving}
            className="px-4 py-1.5 bg-amber-600 text-white text-sm font-semibold rounded-lg hover:bg-amber-700 transition-base disabled:opacity-60"
          >
            {saving ? 'Saving...' : 'Save Order'}
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-10">
          <svg className="animate-spin w-5 h-5 text-brand-600" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
          </svg>
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={buckets.map(b => b.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-2">
              {buckets.map(bucket => (
                <SortableRow
                  key={bucket.id}
                  bucket={bucket}
                  onEdit={openEdit}
                  onDelete={handleDelete}
                  onToggle={handleToggle}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      <div className="mt-6 bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
        <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Condition Keys Reference</p>
        <pre className="text-xs text-gray-600 dark:text-gray-400 whitespace-pre-wrap font-mono leading-relaxed">{`{
  "task_type": ["FIRST_CALL", "RETRY_CALL", "CALLBACK", "FUTURE_CALL"],
  "lead_state": ["NEW", "ATTEMPTING", "CALLBACK_SCHEDULED", ...],
  "due_before": "now"  |  "now+2h"  |  "now-1h",
  "created_before": "now-4h"  |  "now-24h",
  "attempt_count_gte": 2
}`}</pre>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/40 dark:bg-black/60 flex items-start justify-center z-50 p-4 pt-16">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl border border-gray-200 dark:border-gray-800 w-full max-w-lg">
            <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800">
              <h3 className="text-base font-semibold text-gray-900 dark:text-white">
                {editBucket ? 'Edit Bucket' : 'New Priority Bucket'}
              </h3>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Bucket Name</label>
                <input
                  type="text"
                  value={formName}
                  onChange={e => setFormName(e.target.value)}
                  placeholder='e.g. "Overdue Callbacks"'
                  className="w-full px-3.5 py-2.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 dark:focus:ring-brand-900 transition-base bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                />
              </div>

              {!editBucket && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Template</label>
                  <select
                    onChange={e => {
                      const t = CONDITION_TEMPLATES.find(t => t.label === e.target.value);
                      if (t) {
                        setFormName(prev => prev || t.label);
                        setFormConditions(JSON.stringify(t.conditions, null, 2));
                      }
                    }}
                    className="w-full px-3 py-2.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg outline-none focus:border-brand-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-white transition-base"
                  >
                    <option value="">Select a template...</option>
                    {CONDITION_TEMPLATES.map(t => (
                      <option key={t.label} value={t.label}>{t.label}</option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Conditions (JSON)</label>
                <textarea
                  value={formConditions}
                  onChange={e => setFormConditions(e.target.value)}
                  rows={5}
                  className="w-full px-3.5 py-2.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 dark:focus:ring-brand-900 transition-base font-mono resize-none bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                />
              </div>

              {formError && (
                <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2">{formError}</p>
              )}
            </div>
            <div className="px-6 py-4 border-t border-gray-100 dark:border-gray-800 flex gap-3">
              <button
                onClick={() => setShowModal(false)}
                className="flex-1 px-4 py-2.5 text-sm font-medium border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 transition-base"
              >Cancel</button>
              <button
                onClick={handleSaveBucket}
                disabled={!formName || saving}
                className="flex-1 px-4 py-2.5 text-sm font-semibold bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50 transition-base"
              >{saving ? 'Saving...' : editBucket ? 'Save Changes' : 'Create Bucket'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
