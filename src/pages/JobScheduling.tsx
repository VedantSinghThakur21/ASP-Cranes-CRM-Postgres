import React, { useState, useEffect } from 'react';
import { 
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Clock,
  MapPin,
  Plus,
  Truck,
  User,
  X
} from 'lucide-react';
import { format, addDays, startOfWeek, endOfWeek, eachDayOfInterval, addHours, isSameDay, isWithinInterval } from 'date-fns';
import { Card, CardHeader, CardTitle, CardContent } from '../components/common/Card';
import { Button } from '../components/common/Button';
import { Input } from '../components/common/Input';
import { Select } from '../components/common/Select';
import { TextArea } from '../components/common/TextArea';
import { Modal } from '../components/common/Modal';
import { StatusBadge } from '../components/common/StatusBadge';
import { Toast } from '../components/common/Toast';
import { useAuthStore } from '../store/authStore';
import { getJobs, getAllEquipment, getAllOperators, createJob, updateJobStatus } from '../services/jobService';
import { getLeads } from '../services/leadService';
import { getDealById, getDeals } from '../services/dealService';
import { getQuotationsForLead } from '../services/quotationService';
import { Job, Equipment, Operator } from '../types/job';
import { Lead } from '../types/lead';
import { Deal } from '../types/deal';
import { Quotation } from '../types/quotation';
import { useLocation, useNavigate } from 'react-router-dom';

const TIME_SLOTS = Array.from({ length: 15 }, (_, i) => addHours(new Date().setHours(6, 0, 0, 0), i));

export function JobScheduling() {
  const { user } = useAuthStore();
  const [view, setView] = useState<'week' | 'month'>('week');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [jobs, setJobs] = useState<Job[]>([]);
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [operators, setOperators] = useState<Operator[]>([]);  const [leads, setLeads] = useState<Lead[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [wonDealId, setWonDealId] = useState<string | null>(null);
  const [wonDealCustomerName, setWonDealCustomerName] = useState<string | null>(null);
  const [dealEquipment, setDealEquipment] = useState<Equipment[]>([]);
  const [isLoadingEquipment, setIsLoadingEquipment] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const [toast, setToast] = useState<{
    show: boolean;
    title: string;
    description?: string;
    variant?: 'success' | 'error' | 'warning';
  }>({ show: false, title: '' });

  const [formData, setFormData] = useState({
    leadId: '',
    equipmentId: '',
    operatorId: '',
    startDate: '',
    endDate: '',
    location: '',
    notes: '',
  });

  useEffect(() => {
    fetchData();
    
    // Check for URL parameters indicating a won deal
    const params = new URLSearchParams(location.search);
    const dealId = params.get('dealId');
    const action = params.get('action');
    const customerName = params.get('customerName');
    
    if (dealId && action === 'schedule') {
      setWonDealId(dealId);
      if (customerName) {
        const decodedName = decodeURIComponent(customerName);
        setWonDealCustomerName(decodedName);
        
        // Check the definition of showToast to see what parameters it accepts
        setToast({
          show: true,
          title: `Deal won with ${decodedName}!`,
          variant: 'success',
          description: 'Please schedule a job for this customer using the form.'
        });
      }
      
      // Fetch deal data and populate form
      handleOpenFromDeal(dealId);
      
      // Clear the URL parameters
      navigate('/jobs', { replace: true });
    }
  }, [location]);

  const fetchData = async () => {
    try {
      const [jobsData, equipmentData, operatorsData, leadsData, dealsData] = await Promise.all([
        getJobs(),
        getAllEquipment(),
        getAllOperators(),
        getLeads(),
        getDeals(), // Fetch all deals too
      ]);

      setJobs(jobsData);
      setEquipment(equipmentData);
      setOperators(operatorsData);
      
      // Filter leads - keep only those associated with won deals
      const wonDeals = dealsData.filter((deal: Deal) => deal.stage === 'won');
      const wonDealLeadIds = wonDeals.map((deal: Deal) => deal.leadId);
      const relevantLeads = leadsData.filter((lead: Lead) => 
        lead.status === 'converted' && wonDealLeadIds.includes(lead.id)
      );
      
      setLeads(relevantLeads);
      
      // If we have a won deal ID from URL parameters, fetch deal details
      if (wonDealId) {
        try {
          const dealData = await getDealById(wonDealId);
          if (dealData) {
            // Set form data based on won deal
            setFormData(prevData => ({
              ...prevData,
              leadId: dealData.leadId || '',
              location: dealData.customer?.address || '',
              notes: dealData.description || '',
            }));
            
            // Set today's date as default start date and add 7 days for end date
            const today = new Date();
            const nextWeek = new Date();
            nextWeek.setDate(today.getDate() + 7);
            
            setFormData(prevData => ({
              ...prevData,
              startDate: today.toISOString().slice(0, 16), // Include time component
              endDate: nextWeek.toISOString().slice(0, 16) // Include time component
            }));
          }
        } catch (dealError) {
          console.error('Error fetching deal data:', dealError);
        }
      }
    } catch (error) {
      console.error('Error fetching data:', error);
      showToast('Error fetching data', 'error');
    } finally {
      setIsLoading(false);
    }
  };
  const handleOpenFromDeal = async (dealId: string) => {
    try {
      const deal = await getDealById(dealId);

      if (deal) {
        // Set today's date as default start date and add 7 days for end date
        const today = new Date();
        const nextWeek = new Date();
        nextWeek.setDate(today.getDate() + 7);
        
        const formattedStartDate = today.toISOString().slice(0, 16);
        const formattedEndDate = nextWeek.toISOString().slice(0, 16);

        // Set the won deal ID to associate it with the job
        setWonDealId(dealId);
        
        // Set the customer name from the deal
        if (deal.customer?.name) {
          setWonDealCustomerName(deal.customer.name);
        }
          // Fetch quotations associated with this deal's lead ID
        setIsLoadingEquipment(true);
        try {
          const quotations = await getQuotationsForLead(deal.leadId);
          
          if (quotations && quotations.length > 0) {
            // Extract equipment from quotations
            const dealSpecificEquipment: Equipment[] = [];
            
            // Process all quotations to get their equipment
            quotations.forEach(quotation => {
              // Handle single equipment
              if (quotation.selectedEquipment && quotation.selectedEquipment.equipmentId) {
                // Find the equipment in the global equipment list
                const existingEquipment = equipment.find(e => e.id === quotation.selectedEquipment.equipmentId);
                
                if (existingEquipment && !dealSpecificEquipment.some(e => e.id === existingEquipment.id)) {
                  dealSpecificEquipment.push(existingEquipment);
                }
              }
              
              // Handle multiple machines if available
              if (quotation.selectedMachines && quotation.selectedMachines.length > 0) {
                quotation.selectedMachines.forEach(machine => {
                  if (machine.equipmentId) {
                    const existingEquipment = equipment.find(e => e.id === machine.equipmentId);
                    
                    if (existingEquipment && !dealSpecificEquipment.some(e => e.id === existingEquipment.id)) {
                      dealSpecificEquipment.push(existingEquipment);
                    }
                  }
                });
              }
            });
            
            // Update the deal equipment state
            setDealEquipment(dealSpecificEquipment);
            
            // Auto-select the first equipment if available
            if (dealSpecificEquipment.length > 0) {
              setFormData({
                leadId: deal.leadId,
                equipmentId: dealSpecificEquipment[0].id, // Pre-select the first equipment
                operatorId: '',
                startDate: formattedStartDate,
                endDate: formattedEndDate,
                location: deal.customer?.address || '',
                notes: deal.description || '',
              });
            } else {
              setFormData({
                leadId: deal.leadId,
                equipmentId: '',
                operatorId: '',
                startDate: formattedStartDate,
                endDate: formattedEndDate,
                location: deal.customer?.address || '',
                notes: deal.description || '',
              });
            }
          } else {
            // No quotations found, proceed without equipment pre-selection
            setFormData({
              leadId: deal.leadId,
              equipmentId: '',
              operatorId: '',
              startDate: formattedStartDate,
              endDate: formattedEndDate,
              location: deal.customer?.address || '',
              notes: deal.description || '',
            });
          }        } catch (quotationError) {
          console.error('Error fetching quotations:', quotationError);
            // Continue without equipment pre-selection
          setFormData({
            leadId: deal.leadId,
            equipmentId: '',
            operatorId: '',
            startDate: formattedStartDate,
            endDate: formattedEndDate,
            location: deal.customer?.address || '',
            notes: deal.description || '',
          });
        } finally {
          setIsLoadingEquipment(false);
        }
        
        setIsCreateModalOpen(true);
      } else {
        showToast('Deal not found', 'error');
      }
    } catch (error) {
      console.error('Error fetching deal:', error);
      showToast('Error fetching deal', 'error');
    }
  };

  const handleCreateJob = async () => {
    try {
      // Validate required fields
      if (!formData.leadId || !formData.equipmentId || !formData.operatorId || 
          !formData.startDate || !formData.endDate || !formData.location) {
        showToast('Please fill in all required fields', 'error');
        return;
      }
      
      // Get customer name either from lead or from won deal
      let customerName = "";
      
      const lead = leads.find(l => l.id === formData.leadId);
      if (lead) {
        customerName = lead.customerName;
      } else if (wonDealCustomerName) {
        customerName = wonDealCustomerName;
      } else {
        showToast('Customer information is missing', 'error');
        return;
      }

      const newJob = await createJob({
        leadId: formData.leadId,
        customerName,
        equipmentId: formData.equipmentId,
        operatorId: formData.operatorId,
        startDate: formData.startDate,
        endDate: formData.endDate,
        location: formData.location,
        status: 'scheduled',
        notes: formData.notes,
        dealId: wonDealId || undefined, // Link job to deal if it was created from a won deal
      });

      setJobs(prev => [...prev, newJob]);
      setIsCreateModalOpen(false);
      resetForm();
      
      // Clear won deal data
      setWonDealId(null);
      setWonDealCustomerName(null);
      
      showToast('Job scheduled successfully', 'success');
    } catch (error) {
      console.error('Error creating job:', error);
      showToast('Error creating job', 'error');
    }
  };

  const handleStatusChange = async (jobId: string, newStatus: Job['status']) => {
    try {
      const updatedJob = await updateJobStatus(jobId, newStatus);
      if (updatedJob) {
        setJobs(prev => prev.map(job => job.id === jobId ? updatedJob : job));
        showToast('Job status updated', 'success');
      }
    } catch (error) {
      console.error('Error updating job status:', error);
      showToast('Error updating job status', 'error');
    }
  };
  const resetForm = () => {
    setFormData({
      leadId: '',
      equipmentId: '',
      operatorId: '',
      startDate: '',
      endDate: '',
      location: '',
      notes: '',
    });
    // Reset deal equipment as well
    setDealEquipment([]);
  };

  const showToast = (title: string, variant: 'success' | 'error' | 'warning' = 'success') => {
    setToast({ show: true, title, variant });
    setTimeout(() => setToast({ show: false, title: '' }), 3000);
  };

  const checkAvailability = (equipmentId: string, operatorId: string, startDate: string, endDate: string) => {
    const conflictingJobs = jobs.filter(job => {
      const jobStart = new Date(job.startDate);
      const jobEnd = new Date(job.endDate);
      const newStart = new Date(startDate);
      const newEnd = new Date(endDate);

      return (
        (job.equipmentId === equipmentId || job.operatorId === operatorId) &&
        job.status !== 'completed' &&
        job.status !== 'cancelled' &&
        ((newStart >= jobStart && newStart < jobEnd) ||
          (newEnd > jobStart && newEnd <= jobEnd) ||
          (newStart <= jobStart && newEnd >= jobEnd))
      );
    });

    return conflictingJobs;
  };

  const renderWeekView = () => {
    const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 });
    const weekEnd = endOfWeek(currentDate, { weekStartsOn: 1 });
    const days = eachDayOfInterval({ start: weekStart, end: weekEnd });

    return (
      <div className="relative">
        <div className="grid grid-cols-[100px_1fr] gap-4">
          <div className="sticky left-0 bg-white z-10">
            <div className="h-12" />
            {TIME_SLOTS.map((time, i) => (
              <div
                key={i}
                className="h-20 border-b border-gray-100 flex items-center justify-end pr-2 text-sm text-gray-500"
              >
                {format(time, 'h:mm a')}
              </div>
            ))}
          </div>

          <div className="overflow-x-auto">
            <div className="grid grid-cols-7 min-w-[900px]">
              {days.map((day, i) => (
                <div
                  key={i}
                  className="h-12 flex items-center justify-center border-b border-gray-200 font-medium"
                >
                  <div className="text-center">
                    <div className="text-sm text-gray-900">{format(day, 'EEE')}</div>
                    <div className="text-xs text-gray-500">{format(day, 'MMM d')}</div>
                  </div>
                </div>
              ))}

              {TIME_SLOTS.map((time, timeIndex) => (
                <React.Fragment key={timeIndex}>
                  {days.map((day, dayIndex) => {
                    const currentSlotStart = new Date(day.setHours(time.getHours(), time.getMinutes()));
                    // Calculate slot end time for future use if needed
                    // const currentSlotEnd = addHours(currentSlotStart, 1);

                    const slotJobs = jobs.filter(job => {
                      const jobStart = new Date(job.startDate);
                      const jobEnd = new Date(job.endDate);
                      return (
                        isSameDay(currentSlotStart, jobStart) &&
                        isWithinInterval(currentSlotStart, { start: jobStart, end: jobEnd })
                      );
                    });

                    return (
                      <div
                        key={`${timeIndex}-${dayIndex}`}
                        className={`h-20 border-b border-r border-gray-100 relative ${
                          timeIndex === 0 ? 'border-t' : ''
                        } ${dayIndex === 0 ? 'border-l' : ''}`}                        onClick={() => {
                          setIsCreateModalOpen(true);
                          setFormData(prev => ({
                            ...prev,
                            startDate: currentSlotStart.toISOString().slice(0, 16),
                            endDate: addHours(currentSlotStart, 2).toISOString().slice(0, 16),
                          }));
                        }}
                      >
                        {slotJobs.map(job => (
                          <div
                            key={job.id}
                            className="absolute inset-x-0 mx-1 bg-primary-100 border border-primary-200 rounded-md p-2 cursor-pointer hover:bg-primary-200 transition-colors"
                            style={{
                              top: '4px',
                              minHeight: '40px',
                              zIndex: 10,
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedJob(job);
                            }}
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-medium text-sm truncate">
                                {job.customerName}
                              </span>
                              <StatusBadge status={job.status as any} className="ml-2" />
                            </div>
                            <div className="text-xs text-gray-500 mt-1">
                              {format(new Date(job.startDate), 'h:mm a')} - {format(new Date(job.endDate), 'h:mm a')}
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </React.Fragment>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  };

  if (!user || (user.role !== 'operations_manager' && user.role !== 'admin')) {
    return (
      <div className="p-4 text-center text-gray-500">
        You don't have permission to access this page.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentDate(prev => addDays(prev, -7))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          
          <h2 className="text-lg font-semibold">
            {format(currentDate, 'MMMM yyyy')}
          </h2>
          
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentDate(prev => addDays(prev, 7))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        
        <div className="flex items-center gap-4">
          <Select
            options={[
              { value: 'week', label: 'Week View' },
              { value: 'month', label: 'Month View' },
            ]}
            value={view}
            onChange={(value: string) => setView(value as 'week' | 'month')}
            className="w-32"
          />
          
          <Button
            onClick={() => {
              if (leads.length === 0) {
                setToast({
                  show: true,
                  title: 'No Won Deals Available',
                  variant: 'warning',
                  description: 'You need to have at least one won deal before scheduling a job.'
                });
              } else {
                setIsCreateModalOpen(true);
              }
            }}
            leftIcon={<Plus size={16} />}
          >
            New Job
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-6">
          {isLoading ? (
            <div className="text-center py-4">Loading schedule...</div>
          ) : leads.length === 0 ? (
            <div className="text-center py-12 bg-gray-50 rounded-lg">
              <h3 className="text-lg font-medium text-gray-800 mb-2">No Won Deals Yet</h3>
              <p className="text-gray-600">
                Jobs can only be scheduled for deals that have been marked as "won". 
                Return to the Deals page and move a deal to the "won" stage first.
              </p>
            </div>
          ) : (
            renderWeekView()
          )}
        </CardContent>
      </Card>

      <Modal
        isOpen={isCreateModalOpen}
        onClose={() => {
          setIsCreateModalOpen(false);
          resetForm();
        }}
        title={wonDealId ? `Schedule Job for Won Deal: ${wonDealCustomerName || ''}` : "Schedule Job for Won Deal"}
        size="lg"
      >
        <div className="space-y-6">
          {/* Display won deal notice at the top */}
          {wonDealId && (
            <div className="bg-green-50 border border-green-200 p-4 rounded-md mb-4">
              <h4 className="font-medium mb-2 text-green-800">Creating Job from Won Deal</h4>
              <p className="text-green-700">
                <span className="font-medium">Customer:</span> {wonDealCustomerName || 'Unknown customer'}
              </p>
              <p className="text-green-700 text-sm mt-2">
                Please select equipment, operators, and schedule dates for this job.
              </p>
            </div>
          )}
          
          <Select
            label="Select Customer (Won Deals)"
            options={[
              { value: '', label: '-- Select a customer with a won deal --' },
              ...leads.map(lead => ({
                value: lead.id,
                label: `${lead.customerName} - Won Deal`,
              }))
            ]}
            value={formData.leadId}
            onChange={(value: string) => {
              setFormData(prev => ({ ...prev, leadId: value }));
                // When lead selection changes, try to load associated equipment
              if (value) {
                const loadEquipmentFromLead = async () => {
                  setIsLoadingEquipment(true);
                  try {
                    const quotations = await getQuotationsForLead(value);
                    if (quotations && quotations.length > 0) {
                      const leadSpecificEquipment: Equipment[] = [];
                      
                      quotations.forEach(quotation => {
                        // Handle single equipment
                        if (quotation.selectedEquipment && quotation.selectedEquipment.equipmentId) {
                          const existingEquipment = equipment.find(e => e.id === quotation.selectedEquipment.equipmentId);
                          
                          if (existingEquipment && !leadSpecificEquipment.some(e => e.id === existingEquipment.id)) {
                            leadSpecificEquipment.push(existingEquipment);
                          }
                        }
                        
                        // Handle multiple machines
                        if (quotation.selectedMachines && quotation.selectedMachines.length > 0) {
                          quotation.selectedMachines.forEach(machine => {
                            if (machine.equipmentId) {
                              const existingEquipment = equipment.find(e => e.id === machine.equipmentId);
                              
                              if (existingEquipment && !leadSpecificEquipment.some(e => e.id === existingEquipment.id)) {
                                leadSpecificEquipment.push(existingEquipment);
                              }
                            }
                          });
                        }
                      });
                      
                      setDealEquipment(leadSpecificEquipment);
                      
                      // Auto-select the first equipment if available
                      if (leadSpecificEquipment.length > 0) {
                        setFormData(prev => ({
                          ...prev,
                          equipmentId: leadSpecificEquipment[0].id
                        }));
                      }
                    }                  } catch (error) {
                    console.error('Error loading equipment for lead:', error);
                  } finally {
                    setIsLoadingEquipment(false);
                  }
                };
                
                loadEquipmentFromLead();
              } else {
                // Reset equipment selection if no lead is selected
                setDealEquipment([]);
                setFormData(prev => ({
                  ...prev,
                  equipmentId: ''
                }));
              }
            }}
            required
          />

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Select
              label="Equipment"
              options={
                // If we have deal-specific equipment and a wonDealId, use that equipment list
                (dealEquipment.length > 0 && wonDealId) 
                ? [
                    { value: '', label: '-- Select deal-specific equipment --' },
                    ...dealEquipment.map(item => ({
                      value: item.id,
                      label: `${item.name} (From Deal)`,
                    }))
                  ] 
                : [
                    { value: '', label: '-- Select equipment --' },
                    ...equipment.map(item => ({
                      value: item.id,
                      label: item.name,
                    }))
                  ]
              }
              value={formData.equipmentId}
              onChange={(value: string) => setFormData(prev => ({ ...prev, equipmentId: value }))}              required
            />
                {/* Information about equipment selection */}
              {isLoadingEquipment ? (
                <p className="mt-1 text-xs text-blue-600">
                  Loading equipment from quotations...
                </p>
              ) : dealEquipment.length > 0 ? (
                <p className="mt-1 text-xs text-green-600">
                  {dealEquipment.length} equipment item{dealEquipment.length !== 1 ? 's' : ''} from deal quotation{dealEquipment.length !== 1 ? 's' : ''}
                </p>
              ) : formData.leadId ? (
                <p className="mt-1 text-xs text-gray-500">
                  No specific equipment found in deal quotations
                </p>
              ) : null}
            </div>

            <Select
              label="Operator"
              options={operators.map(op => ({
                value: op.id,
                label: op.name,
              }))}
              value={formData.operatorId}
              onChange={(value: string) => setFormData(prev => ({ ...prev, operatorId: value }))}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Input
              type="datetime-local"
              label="Start Date & Time"
              value={formData.startDate}
              onChange={(e) => setFormData(prev => ({ ...prev, startDate: e.target.value }))}
              required
            />

            <Input
              type="datetime-local"
              label="End Date & Time"
              value={formData.endDate}
              onChange={(e) => setFormData(prev => ({ ...prev, endDate: e.target.value }))}
              required
            />
          </div>

          <Input
            label="Location"
            value={formData.location}
            onChange={(e) => setFormData(prev => ({ ...prev, location: e.target.value }))}
            required
          />

          <TextArea
            label="Notes"
            value={formData.notes}
            onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
            rows={4}
          />

          {formData.equipmentId && formData.operatorId && formData.startDate && formData.endDate && (
            <div className="bg-gray-50 p-4 rounded-md">
              <h4 className="font-medium mb-2">Availability Check</h4>
              {(() => {
                const conflicts = checkAvailability(
                  formData.equipmentId,
                  formData.operatorId,
                  formData.startDate,
                  formData.endDate
                );

                return conflicts.length > 0 ? (
                  <div className="text-error-600">
                    <p>Conflicts found:</p>
                    <ul className="list-disc list-inside text-sm">
                      {conflicts.map(conflict => (
                        <li key={conflict.id}>
                          {conflict.customerName} - {format(new Date(conflict.startDate), 'MMM d, h:mm a')}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p className="text-success-600">Equipment and operator are available for the selected time slot.</p>
                );
              })()}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <Button
            variant="outline"
            onClick={() => {
              setIsCreateModalOpen(false);
              resetForm();
            }}
          >
            Cancel
          </Button>
          <Button onClick={handleCreateJob}>Schedule Job</Button>
        </div>
      </Modal>

      <Modal
        isOpen={!!selectedJob}
        onClose={() => setSelectedJob(null)}
        title="Job Details"
        size="lg"
      >
        {selectedJob && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-6">
              <div>
                <h4 className="text-sm font-medium text-gray-500">Customer</h4>
                <p className="mt-1">{selectedJob.customerName}</p>
              </div>

              <div>
                <h4 className="text-sm font-medium text-gray-500">Status</h4>
                <div className="mt-1">
                  <Select
                    options={[
                      { value: 'scheduled', label: 'Scheduled' },
                      { value: 'in_progress', label: 'In Progress' },
                      { value: 'completed', label: 'Completed' },
                      { value: 'cancelled', label: 'Cancelled' },
                    ]}
                    value={selectedJob.status}
                    onChange={(value: string) => handleStatusChange(selectedJob.id, value as Job['status'])}
                  />
                </div>
              </div>

              <div>
                <h4 className="text-sm font-medium text-gray-500">Equipment</h4>
                <p className="mt-1">
                  {equipment.find(e => e.id === selectedJob.equipmentId)?.name}
                </p>
              </div>

              <div>
                <h4 className="text-sm font-medium text-gray-500">Operator</h4>
                <p className="mt-1">
                  {operators.find(o => o.id === selectedJob.operatorId)?.name}
                </p>
              </div>

              <div>
                <h4 className="text-sm font-medium text-gray-500">Start Date</h4>
                <p className="mt-1">
                  {format(new Date(selectedJob.startDate), 'MMM d, yyyy h:mm a')}
                </p>
              </div>

              <div>
                <h4 className="text-sm font-medium text-gray-500">End Date</h4>
                <p className="mt-1">
                  {format(new Date(selectedJob.endDate), 'MMM d, yyyy h:mm a')}
                </p>
              </div>

              <div className="col-span-2">
                <h4 className="text-sm font-medium text-gray-500">Location</h4>
                <p className="mt-1">{selectedJob.location}</p>
              </div>

              <div className="col-span-2">
                <h4 className="text-sm font-medium text-gray-500">Notes</h4>
                <p className="mt-1 whitespace-pre-wrap">{selectedJob.notes || 'No notes'}</p>
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <Button
                variant="outline"
                onClick={() => setSelectedJob(null)}
              >
                Close
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {toast.show && (
        <Toast
          title={toast.title}
          description={toast.description}
          variant={toast.variant}
          isVisible={toast.show}
          duration={3000}
          onClose={() => setToast({ show: false, title: '' })}
        />
      )}
    </div>
  );
}
