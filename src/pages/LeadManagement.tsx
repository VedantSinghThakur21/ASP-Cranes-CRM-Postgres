import React, { useState, useEffect } from 'react';
import { 
  Plus, 
  Search, 
  Filter,
  FileText,
  MapPin,
  Phone,
  Mail,
  Upload,
  Trash2,
  Building2,
  Users,
  ArrowRight
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../components/common/Card';
import { Input } from '../components/common/Input';
import { Button } from '../components/common/Button';
import { Select } from '../components/common/Select';
import { TextArea } from '../components/common/TextArea';
import { Modal } from '../components/common/Modal';
import { StatusBadge } from '../components/common/StatusBadge';
import { Toast } from '../components/common/Toast';
import { CustomerSelectionModal } from '../components/common/CustomerSelectionModal';
import { useAuthStore } from '../store/authStore';
import { Lead, LeadStatus, Customer } from '../types/lead';
import { getLeads, createLead, updateLeadStatus, updateLeadAssignment } from '../services/firestore/leadService';
import { createDeal } from '../services/dealService';
import { useNavigate } from 'react-router-dom';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../lib/firebase';

const LEAD_STATUS_OPTIONS = [
  { value: 'new', label: 'New' },
  { value: 'in_process', label: 'In Process' },
  { value: 'qualified', label: 'Qualified' },
  { value: 'unqualified', label: 'Unqualified' },
  { value: 'lost', label: 'Lost' },
];

const MACHINERY_OPTIONS = [
  { value: 'mobile_crane', label: 'Mobile Crane' },
  { value: 'tower_crane', label: 'Tower Crane' },
  { value: 'crawler_crane', label: 'Crawler Crane' },
  { value: 'pick_and_carry_crane', label: 'Pick & Carry Crane' },
];

const SHIFT_OPTIONS = [
  { value: 'day', label: 'Day Shift' },
  { value: 'night', label: 'Night Shift' },
  { value: '24x7', label: '24x7' },
];

export function LeadManagement() {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [salesAgents, setSalesAgents] = useState<{ id: string; name: string; }[]>([]);
  const [filteredLeads, setFilteredLeads] = useState<Lead[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<LeadStatus | 'all'>('all');
  const [isLoading, setIsLoading] = useState(true);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isCustomerSelectionModalOpen, setIsCustomerSelectionModalOpen] = useState(false);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [toast, setToast] = useState<{
    show: boolean;
    title: string;
    description?: string;
    variant?: 'success' | 'error' | 'warning';
  }>({ show: false, title: '' });

  const today = new Date().toISOString().split('T')[0];

  const [formData, setFormData] = useState({
    fullName: '',
    companyName: '',
    phoneNumber: '',
    email: '',
    machineryType: '',
    location: '',
    startDate: today,
    rentalDays: '',
    shiftTiming: 'day',
    notes: '',
    assignedTo: '',
    designation: '',
  });

  useEffect(() => {
    fetchLeads();
    fetchSalesAgents();
  }, []);

  useEffect(() => {
    filterLeads();
  }, [leads, searchTerm, statusFilter]);

  const fetchLeads = async () => {
    try {
      const data = await getLeads();
      setLeads(data);
      setIsLoading(false);
    } catch (error) {
      console.error('Error fetching leads:', error);
      showToast('Error fetching leads', 'error');
      setIsLoading(false);
    }
  };

  const fetchSalesAgents = async () => {
    try {
      const usersRef = collection(db, 'users');
      const q = query(usersRef, where('role', '==', 'sales_agent'));
      const snapshot = await getDocs(q);
      const agents = snapshot.docs.map(doc => ({
        id: doc.id,
        name: doc.data().name,
      }));
      setSalesAgents(agents);
    } catch (error) {
      console.error('Error fetching sales agents:', error);
      showToast('Error fetching sales agents', 'error');
    }
  };

  const filterLeads = () => {
    let filtered = [...leads];
    
    if (searchTerm) {
      filtered = filtered.filter(lead => 
        lead.customerName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        lead.siteLocation.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }
    
    if (statusFilter !== 'all') {
      filtered = filtered.filter(lead => lead.status === statusFilter);
    }
    
    setFilteredLeads(filtered);
  };

  const handleCreateLead = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate required fields
    if (!formData.fullName || !formData.phoneNumber || !formData.email || 
        !formData.machineryType || !formData.location || !formData.startDate || 
        !formData.rentalDays) {
      showToast('Please fill in all required fields', 'error');
      return;
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(formData.email)) {
      showToast('Please enter a valid email address', 'error');
      return;
    }

    // Validate phone number (basic validation)
    const phoneRegex = /^\+?[\d\s-]{10,}$/;
    if (!phoneRegex.test(formData.phoneNumber)) {
      showToast('Please enter a valid phone number', 'error');
      return;
    }

    try {
      // If user is a sales agent, automatically assign the lead to them
      const assignedTo = user?.role === 'sales_agent' ? user.id : formData.assignedTo;
      const assignedToName = user?.role === 'sales_agent' ? user.name : 
        salesAgents.find(agent => agent.id === formData.assignedTo)?.name || '';

      const newLead = await createLead({
        customerName: formData.fullName,
        companyName: formData.companyName,
        email: formData.email,
        phone: formData.phoneNumber,
        serviceNeeded: formData.machineryType,
        siteLocation: formData.location,
        startDate: formData.startDate,
        rentalDays: parseInt(formData.rentalDays),
        shiftTiming: formData.shiftTiming,
        status: 'new',
        assignedTo,
        assignedToName,
        notes: formData.notes,
        designation: formData.designation,
      });

      setLeads(prev => [...prev, newLead]);
      setIsCreateModalOpen(false);
      resetForm();
      showToast('Lead created successfully', 'success');
    } catch (error) {
      console.error('Error creating lead:', error);
      showToast('Error creating lead', 'error');
    }
  };

  const handleStatusChange = async (leadId: string, newStatus: LeadStatus) => {
    try {
      const updatedLead = await updateLeadStatus(leadId, newStatus);
      if (updatedLead) {
        setLeads(prev => 
          prev.map(lead => 
            lead.id === leadId ? updatedLead : lead
          )
        );
        
        showToast('Lead status updated', 'success');
      }
    } catch (error) {
      console.error('Error updating lead status:', error);
      showToast('Error updating lead status', 'error');
    }
  };

  const handleCustomerSelect = async (customer: Customer) => {
    if (!selectedLead) return;

    try {
      console.log('Creating deal from lead:', selectedLead);
      console.log('Selected customer:', customer);
      
      // Create a new deal from the lead with the selected customer
      const deal = await createDeal({
        title: `Deal for ${customer.name}`,
        description: `Deal created from lead for ${customer.name}${customer.companyName ? ` (${customer.companyName})` : ''}`,
        leadId: selectedLead.id,
        customerId: customer.id,
        stage: 'qualification',
        value: 0, // This will be set in the deals form
        expectedCloseDate: new Date().toISOString(),
        customer: {
          name: customer.name,
          email: customer.email || selectedLead.email,
          phone: customer.phone || selectedLead.phone,
          company: customer.companyName || '',
          address: customer.address || '',
          designation: customer.designation || 'N/A'
        },
        probability: 0,
        createdBy: user?.id || '',
        assignedTo: selectedLead.assignedTo || user?.id || ''
      });

      console.log('Deal created successfully:', deal);
      
      // Update lead status to qualified since it's been converted to a deal
      await updateLeadStatus(selectedLead.id, 'qualified');
      
      showToast('Lead converted to deal successfully', 'success');
      setIsCustomerSelectionModalOpen(false);
      setSelectedLead(null);
      navigate('/deals');
    } catch (error) {
      console.error('Error converting lead to deal:', error);
      showToast('Error converting lead to deal', 'error');
    }
  };

  const handleConvertToDeal = async (lead: Lead) => {
    if (lead.status !== 'qualified') {
      showToast('Only qualified leads can be converted to deals', 'warning');
      return;
    }
    setSelectedLead(lead);
    setIsCustomerSelectionModalOpen(true);
  };

  const handleAssignmentChange = async (leadId: string, salesAgentId: string) => {
    try {
      const selectedAgent = salesAgents.find(agent => agent.id === salesAgentId);
      if (!selectedAgent) {
        showToast('Selected sales agent not found', 'error');
        return;
      }

      const updatedLead = await updateLeadAssignment(leadId, salesAgentId, selectedAgent.name);
      if (updatedLead) {
        setLeads(prev => 
          prev.map(lead => 
            lead.id === leadId ? updatedLead : lead
          )
        );
        showToast('Lead assignment updated', 'success');
      }
    } catch (error) {
      console.error('Error updating lead assignment:', error);
      showToast('Error updating lead assignment', 'error');
    }
  };

  const resetForm = () => {
    setFormData({
      fullName: '',
      companyName: '',
      phoneNumber: '',
      email: '',
      machineryType: '',
      location: '',
      startDate: today,
      rentalDays: '',
      shiftTiming: 'day',
      notes: '',
      assignedTo: '',
      designation: '',
    });
  };

  const showToast = (
    title: string,
    variant: 'success' | 'error' | 'warning' = 'success'
  ) => {
    setToast({ show: true, title, variant });
    setTimeout(() => setToast({ show: false, title: '' }), 3000);
  };

  if (!user || (user.role !== 'sales_agent' && user.role !== 'admin')) {
    return (
      <div className="p-4 text-center text-gray-500">
        You don't have permission to access this page.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex flex-col sm:flex-row gap-4 flex-1">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 h-5 w-5" />
            <Input
              placeholder="Search leads..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
          
          <Select
            options={[
              { value: 'all', label: 'All Status' },
              ...LEAD_STATUS_OPTIONS
            ]}
            value={statusFilter}
            onChange={(value) => setStatusFilter(value as LeadStatus | 'all')}
            className="w-40"
          />
        </div>
        
        <Button
          onClick={() => setIsCreateModalOpen(true)}
          leftIcon={<Plus size={16} />}
        >
          New Lead
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Lead Pipeline</CardTitle>
        </CardHeader>
        <CardContent>
        {isLoading ? (
            <div className="text-center py-4">Loading leads...</div>
        ) : filteredLeads.length === 0 ? (
            <div className="text-center py-4 text-gray-500">
              No leads found. Create a new lead to get started.
          </div>
        ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Customer
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Service
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Location
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Assigned To
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {filteredLeads.map((lead) => (
                    <tr key={lead.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div>
                          <div className="font-medium text-gray-900">{lead.customerName}</div>
                          {lead.companyName && (
                  <div className="text-sm text-gray-500">{lead.companyName}</div>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">{lead.serviceNeeded}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">{lead.siteLocation}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <Select
                          value={lead.status}
                          onChange={(value) => handleStatusChange(lead.id, value as LeadStatus)}
                          options={LEAD_STATUS_OPTIONS}
                          className="min-w-[130px]"
                        />
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {user?.role === 'admin' ? (
                          <Select
                            value={lead.assignedTo || ''}
                            onChange={(value) => handleAssignmentChange(lead.id, value)}
                            options={[
                              { value: '', label: 'Unassigned' },
                              ...salesAgents.map(agent => ({
                                value: agent.id,
                                label: agent.name,
                              }))
                            ]}
                            className="min-w-[160px]"
                          />
                        ) : (
                          <div className="text-sm text-gray-900">
                            {lead.assignedToName || 'Unassigned'}
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <div className="flex items-center space-x-2">
                          {lead.status === 'qualified' && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleConvertToDeal(lead)}
                              leftIcon={<ArrowRight size={16} />}
                            >
                              Convert to Deal
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create Lead Modal */}
      <Modal
        isOpen={isCreateModalOpen}
        onClose={() => {
          setIsCreateModalOpen(false);
          resetForm();
        }}
        title="Create New Lead"
        size="lg"
      >
        <form onSubmit={handleCreateLead} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Input
              label="Full Name"
              value={formData.fullName}
              onChange={(e) => setFormData(prev => ({ ...prev, fullName: e.target.value }))}
              required
            />

            <Input
              label="Company Name"
              value={formData.companyName}
              onChange={(e) => setFormData(prev => ({ ...prev, companyName: e.target.value }))}
              helperText="Optional"
            />

            <Input
              label="Phone Number"
              type="tel"
              value={formData.phoneNumber}
              onChange={(e) => setFormData(prev => ({ ...prev, phoneNumber: e.target.value }))}
              required
            />

            <Input
              label="Email Address"
              type="email"
              value={formData.email}
              onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
              required
            />

            <Select
              label="Type of Machinery Needed"
              options={[
                { value: '', label: 'Select Machinery Type' },
                ...MACHINERY_OPTIONS
              ]}
              value={formData.machineryType}
              onChange={(value) => setFormData(prev => ({ ...prev, machineryType: value }))}
              required
            />

            <Input
              label="Location / Site Address"
              value={formData.location}
              onChange={(e) => setFormData(prev => ({ ...prev, location: e.target.value }))}
              required
            />

            <Input
              label="Start Date"
              type="date"
              value={formData.startDate}
              min={today}
              onChange={(e) => setFormData(prev => ({ ...prev, startDate: e.target.value }))}
              required
            />

            <Input
              label="Number of Rental Days"
              type="number"
              min="1"
              onWheel={(e) => e.currentTarget.blur()}
              onKeyDown={(e) => {
                if (e.key === '-' || e.key === 'e' || e.key === '.') {
                  e.preventDefault();
                }
              }}
              value={formData.rentalDays}
              onChange={(e) => {
                const value = Math.max(1, parseInt(e.target.value) || 1);
                setFormData(prev => ({ ...prev, rentalDays: value.toString() }));
              }}
              required
            />

            <Select
              label="Shift Timing"
              options={SHIFT_OPTIONS}
              value={formData.shiftTiming}
              onChange={(value) => setFormData(prev => ({ ...prev, shiftTiming: value }))}
              required
            />

            <Input
              label="Designation"
              value={formData.designation}
              onChange={(e) => setFormData(prev => ({ ...prev, designation: e.target.value }))}
              placeholder="Enter designation"
              helperText="Optional"
            />

            {/* Only show sales agent assignment for admin users */}
            {user?.role === 'admin' && (
              <Select
                label="Assign To"
                options={[
                  { value: '', label: 'Select Sales Agent' },
                  ...salesAgents.map(agent => ({
                    value: agent.id,
                    label: agent.name,
                  }))
                ]}
                value={formData.assignedTo}
                onChange={(value) => setFormData(prev => ({ ...prev, assignedTo: value }))}
                required
              />
            )}
          </div>

          <TextArea
            label="Additional Notes"
            value={formData.notes}
            onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
            rows={3}
          />

          <div className="flex justify-end gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setIsCreateModalOpen(false);
                resetForm();
              }}
            >
              Cancel
            </Button>
            <Button type="submit">
              Create Lead
            </Button>
          </div>
        </form>
      </Modal>

      {/* Customer Selection Modal */}
      <CustomerSelectionModal
        isOpen={isCustomerSelectionModalOpen}
        onClose={() => {
          setIsCustomerSelectionModalOpen(false);
          setSelectedLead(null);
        }}
        onSelect={handleCustomerSelect}
        initialCustomerData={selectedLead ? {
          name: selectedLead.customerName,
          email: selectedLead.email,
          phone: selectedLead.phone,
          companyName: selectedLead.companyName || 'Korean.org',
          address: selectedLead.siteLocation || 'N/A',
          designation: selectedLead.designation || 'Founder'
        } : undefined}
      />

      {/* Toast Notifications */}
      {toast.show && (
        <Toast
          title={toast.title}
          variant={toast.variant}
          isVisible={toast.show}
          onClose={() => setToast({ show: false, title: '' })}
        />
      )}
    </div>
  );
}